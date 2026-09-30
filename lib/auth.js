"use client";

import { createContext, useContext, useState, useEffect, useRef } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db, firebaseConfig } from "./firebase";
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import * as OTPAuth from "otpauth";
import toast from "react-hot-toast";
import { canAccessModule as canAccessModuleForUser } from "./permissions";
import { subscribeCompanyProfile } from "./companyProfile";

const AuthContext = createContext();

// Roles that get full in-app access, identical to "Admin" (all branches, all
// modules, no lock restrictions). Deliberately separate from the license
// system: adding a role here only affects permissions *inside* the app, it
// has no bearing on `isSuperAdmin` / the license, which stays a manual,
// per-user Firestore flag set outside the app. See README-LICENSE.md.
export const ADMIN_LEVEL_ROLES = ["Admin", "General Manager"];

// ---------- TOTP Helpers ----------
export function generateTOTPSecret() {
  // otpauth Secret random 20 bytes -> base32
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32;
}

export function verifyTOTP(token, secret) {
  try {
    if (!token || !secret) return false;
    const cleaned = token.replace(/\s/g, "");
    const totp = new OTPAuth.TOTP({
      issuer: "TravelAgency",
      label: "TravelAgency",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const delta = totp.validate({ token: cleaned, window: 1 });
    return delta !== null;
  } catch (e) {
    console.error("verifyTOTP error", e);
    return false;
  }
}

export function setup2FA(username) {
  const secret = generateTOTPSecret();
  const totp = new OTPAuth.TOTP({
    issuer: "TravelAgency",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const url = totp.toString(); // otpauth://totp/TravelAgency:username?secret=XXX&issuer=TravelAgency...
  // Ensure issuer param present
  return { secret, url };
}

function buildTOTPUrl(username, secret) {
  const totp = new OTPAuth.TOTP({
    issuer: "TravelAgency",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

// A signed-out visitor has to resolve "username" -> "email" before they can
// even attempt signInWithEmailAndPassword — but the ONLY thing that lookup
// needs is the email. It used to run a `list` query against the full
// /users collection (limit(1) only, per the Firestore rule) and read
// `.email` off the result — except Firestore doesn't support column
// projection, so the matching document's ENTIRE content, including
// totpSecret, totpEnabled, role and branches, was downloaded to the
// browser first. Anyone who knew or guessed a valid username could read
// another employee's live 2FA secret while not even signed in — enough to
// generate their TOTP codes and defeat their 2FA entirely.
// /usernames/{username} is a minimal public mirror — {email, uid} only,
// nothing sensitive — kept in sync by register()/updateUser() below via
// the same batch as the real /users write, so it can never drift out of
// sync with who actually owns that username.
async function findEmailByUsername(username) {
  const lower = username.toLowerCase().trim();
  const snap = await getDoc(doc(db, "usernames", lower));
  if (snap.exists() && snap.data().email) return { email: snap.data().email, viaFallback: false };
  // FALLBACK (root fix): accounts created through this app's username-only
  // flow always get the deterministic internal email `<username>@noemail.local`
  // (see handleCreateAdmin in the login page). So a missing /usernames mirror
  // doc no longer locks anyone out: we try that email directly.
  // IMPORTANT: a fallback login is only accepted if, after signing in, the
  // account's own /users profile really carries this exact username (checked
  // in loginWithUsernameOrEmail). That keeps renamed usernames and removed
  // employees from logging in through this path.
  if (!/^[a-z0-9_.]{3,20}$/.test(lower)) return null;
  return { email: `${lower}@noemail.local`, viaFallback: true };
}

// Self-healing: once someone has successfully signed in we know their real
// email + uid, so if their /usernames mirror doc is missing (old account,
// failed batch, hand-edited data...) we recreate it right here. Best-effort:
// never blocks or fails a login. Allowed by the /usernames create rule in
// firestore.rules (own uid + own auth email + own users/{uid}.username only).
async function ensureUsernameMirror(user, profile) {
  try {
    if (!user || !profile?.username) return;
    const uname = String(profile.username).toLowerCase().trim();
    if (!uname) return;
    const ref = doc(db, "usernames", uname);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, { email: (user.email || profile.email || "").toLowerCase(), uid: user.uid });
  } catch (e) {
    console.warn("ensureUsernameMirror skipped", e);
  }
}

async function isUsernameTaken(username, excludeUid = null) {
  const lower = username.toLowerCase().trim();
  const snap = await getDoc(doc(db, "usernames", lower));
  if (!snap.exists()) return false;
  if (excludeUid) return snap.data().uid !== excludeUid;
  return true;
}

// A user is considered "online" if their heartbeat (lastActiveAt) landed
// within this window. Kept in one place so the Settings > Employees list
// and any other online/offline indicator stay in sync.
export const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

export function isUserOnline(u) {
  const ts = u?.lastActiveAt;
  const millis = ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : null;
  if (!millis) return false;
  return Date.now() - millis < ONLINE_THRESHOLD_MS;
}

// Central activity log — every entry lands in the `activityLog` collection
// so Settings > History can show a single timeline across all employees.
// Deliberately a plain async function (not a hook) so it can be called from
// anywhere: inside AuthProvider (login/logout) or from other pages (e.g. an
// admin editing/deleting an employee in Settings).
export async function logActivity({ userId, username, name, action, meta = {} }) {
  try {
    await addDoc(collection(db, "activityLog"), {
      userId: userId || null,
      username: username || null,
      name: name || null,
      action,
      meta,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("logActivity failed", e);
  }
}

// Admin action: force-sign-out an employee's active session(s). We can't
// revoke a Firebase Auth session from the client (that needs the Admin SDK
// / a Cloud Function, neither of which this project has), so instead we
// write a "kick" timestamp to the user's own doc. Every signed-in client
// listens to its own user doc live (see AuthProvider below) and signs
// itself out the moment it sees a forceLogoutAt newer than when its
// session started — in practice this takes effect within a few seconds on
// any tab that's open, and immediately on their next page load otherwise.
export async function forceSignOutUser(targetUser, actor) {
  await updateDoc(doc(db, "users", targetUser.id), {
    forceLogoutAt: serverTimestamp(),
    forceLogoutBy: actor?.name || actor?.username || null,
  });
  await logActivity({
    userId: actor?.uid || null,
    username: actor?.username || null,
    name: actor?.name || null,
    action: "force_logout",
    meta: { targetUserId: targetUser.id, targetName: targetUser.name || targetUser.username || targetUser.email },
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending2FA, setPending2FA] = useState(false);
  const [pendingSecret, setPendingSecret] = useState(null);
  const [pendingUser, setPendingUser] = useState(null);
  const [branchesList, setBranchesList] = useState([]); // all branches, {id, code, name}
  const [activeBranch, setActiveBranchState] = useState(null);
  // Global, company-wide feature switches set by a true Admin in
  // Settings > App Features: { [moduleKey]: true|false }. A key that's
  // missing/undefined defaults to "on". Applies to every user regardless
  // of role, General Manager included.
  const [appFeatures, setAppFeatures] = useState({});
  // When this browser session started being signed in — used to tell a
  // fresh forceLogoutAt (set by an admin after this moment) apart from a
  // stale one left over from a previous session.
  const sessionStartedAtRef = useRef(null);

  // Company branding (name/logo/contact) — loaded once here so it's ready
  // in cache by the time anything gets printed anywhere in the app.
  useEffect(() => {
    const unsub = subscribeCompanyProfile();
    return unsub;
  }, []);

  const isAdmin = ADMIN_LEVEL_ROLES.includes(userData?.role);
  // Only a real Admin, never General Manager, may view or change the
  // global App Features switches — mirrors the same "true admin only"
  // carve-out used for seeing other Admin accounts in Employees.
  const isTrueAdmin = userData?.role === "Admin";
  // The set of branch codes this user is allowed to work in / see.
  // Admins aren't restricted to a set — they can reach every branch — this
  // is only meaningful for non-admin users.
  const myBranches = userData?.branches || [];

  // Load the master branch list once signed in (needed for the switcher
  // and for Admins picking which branch a new record belongs to).
  useEffect(() => {
    if (!user) {
      setBranchesList([]);
      return;
    }
    const unsub = onSnapshot(
      collection(db, "branches"),
      (snap) => setBranchesList(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    return () => unsub();
  }, [user]);

  // Load the global App Features doc — every signed-in user listens live so
  // a module an Admin just switched off disappears immediately everywhere,
  // not just after a refresh.
  useEffect(() => {
    if (!user) {
      setAppFeatures({});
      return;
    }
    const unsub = onSnapshot(
      doc(db, "settings", "appFeatures"),
      (snap) => setAppFeatures(snap.exists() ? snap.data() : {}),
      () => {}
    );
    return () => unsub();
  }, [user]);

  // Heartbeat: refresh this user's lastActiveAt every ~45s while signed in,
  // so Settings > Employees can show a live online/offline status for
  // everyone. Also pings immediately whenever the tab regains focus, so
  // switching back to it doesn't leave a stale "offline" reading for up to
  // 45s.
  useEffect(() => {
    if (!user) return;
    const beat = () => {
      updateDoc(doc(db, "users", user.uid), { lastActiveAt: serverTimestamp() }).catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 45000);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.uid]);

  // Auto sign-out after 30 minutes with no mouse/keyboard/touch/scroll
  // activity anywhere on the page. Any interaction resets the clock: only
  // continuous idle time counts, not total session length.
  useEffect(() => {
    if (!user) return;
    const IDLE_LIMIT_MS = 30 * 60 * 1000;
    let timer;
    const onIdle = () => {
      toast.error("You've been signed out after 30 minutes of inactivity.");
      logout();
    };
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, IDLE_LIMIT_MS);
    };
    const activityEvents = ["mousedown", "mousemove", "keydown", "wheel", "touchstart", "scroll"];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      clearTimeout(timer);
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Live-sync this user's own Firestore doc (role/permission changes apply
  // immediately) and watch for an admin-issued forceLogoutAt "kick" — if
  // one lands after this session started, sign out locally right away.
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setUserData((prev) => (prev ? { ...prev, ...data, uid: user.uid } : { uid: user.uid, ...data }));
      const kickAt = data.forceLogoutAt?.toMillis ? data.forceLogoutAt.toMillis() : null;
      if (kickAt && sessionStartedAtRef.current && kickAt > sessionStartedAtRef.current) {
        toast.error("You've been signed out by an administrator.");
        logout();
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Initialize / restore the active (working) branch once we know who the
  // user is and which branches they can reach.
  useEffect(() => {
    if (!user || !userData) return;
    const uid = user.uid;
    const stored = typeof window !== "undefined" ? localStorage.getItem(`activeBranch_${uid}`) : null;
    if (isAdmin) {
      // Admin default: "ALL" (combined view) unless they had a specific
      // branch selected last time.
      setActiveBranchState(stored || "ALL");
    } else if (myBranches.length > 0) {
      const valid = stored && myBranches.includes(stored) ? stored : myBranches[0];
      setActiveBranchState(valid);
    } else {
      setActiveBranchState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, userData?.role, JSON.stringify(myBranches)]);

  const setActiveBranch = (branchCode) => {
    setActiveBranchState(branchCode);
    if (user && typeof window !== "undefined") {
      localStorage.setItem(`activeBranch_${user.uid}`, branchCode);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        sessionStartedAtRef.current = Date.now();
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserData({ uid: firebaseUser.uid, ...data });
            // If user has 2FA enabled but not verified in this session, enforce pending
            // Check sessionStorage verified flag
            const verified = sessionStorage.getItem(`2faVerified_${firebaseUser.uid}`);
            if (data.totpEnabled && data.totpSecret && !verified && !pending2FA) {
              // Do not auto-set pending on reload? Keep simple: only enforce if pending already set
              // To avoid locking out already verified session, we only set pending if not verified
              // But first login flow sets pending explicitly; on reload without verified flag, set pending
              // Uncomment to enforce 2FA on every reload:
              // setPending2FA(true);
              // setPendingSecret(data.totpSecret);
              // setPendingUser(firebaseUser);
            }
          } else {
            const fallbackName = firebaseUser.email?.split("@")[0] || "User";
            setUserData({ role: "Employee", name: fallbackName, email: firebaseUser.email });
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          const fallbackName = firebaseUser.email?.split("@")[0] || "User";
          setUserData({ role: "Employee", name: fallbackName, email: firebaseUser.email });
        }
      } else {
        setUser(null);
        setUserData(null);
        setPending2FA(false);
        setPendingSecret(null);
        setPendingUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithUsernameOrEmail = async (identifier, password) => {
    const trimmed = identifier.trim();
    if (trimmed.includes("@")) {
      throw new Error("Please sign in with your username, not your email address");
    }
    const found = await findEmailByUsername(trimmed);
    if (!found) {
      throw new Error("Username not found");
    }
    const result = await signInWithEmailAndPassword(auth, found.email, password);
    // Fetch user doc to check 2FA
    const userDoc = await getDoc(doc(db, "users", result.user.uid));
    const data = userDoc.exists() ? userDoc.data() : null;
    if (found.viaFallback) {
      const profileUsername = String(data?.username || "").toLowerCase().trim();
      if (!data || profileUsername !== trimmed.toLowerCase()) {
        try { await signOut(auth); } catch {}
        throw new Error("auth/invalid-credential");
      }
    }
    ensureUsernameMirror(result.user, data);
    if (data && data.totpEnabled && data.totpSecret) {
      setPending2FA(true);
      setPendingSecret(data.totpSecret);
      setPendingUser(result.user);
      // Mark userData but pending blocks access
      setUserData({ uid: result.user.uid, ...data });
      // Keep signed in but flagged as pending
      return { needs2FA: true, secret: data.totpSecret, tempUser: result.user };
    } else {
      setPending2FA(false);
      setPendingSecret(null);
      setPendingUser(null);
      // Ensure verified flag for non-2FA users
      sessionStorage.setItem(`2faVerified_${result.user.uid}`, "true");
      if (data) setUserData({ uid: result.user.uid, ...data });
      logActivity({ userId: result.user.uid, username: data?.username, name: data?.name, action: "login" });
      return { needs2FA: false, user: result.user };
    }
  };

  // Backward compatible login (email only) - also delegates to username logic
  const login = async (email, password) => {
    return loginWithUsernameOrEmail(email, password);
  };

  const verify2FA = async (token) => {
    if (!pendingSecret) throw new Error("No pending 2FA verification");
    const valid = verifyTOTP(token, pendingSecret);
    if (valid) {
      setPending2FA(false);
      // Keep secret for session
      const uid = pendingUser?.uid || auth.currentUser?.uid;
      if (uid) sessionStorage.setItem(`2faVerified_${uid}`, "true");
      setPendingSecret(null);
      setPendingUser(null);
      logActivity({ userId: uid, username: userData?.username, name: userData?.name, action: "login" });
      return true;
    }
    return false;
  };

  const verifyAndCompleteLogin = async (token, secret) => {
    const s = secret || pendingSecret;
    if (!s) throw new Error("No secret provided");
    const valid = verifyTOTP(token, s);
    if (valid) {
      setPending2FA(false);
      setPendingSecret(null);
      setPendingUser(null);
      const uid = auth.currentUser?.uid;
      if (uid) sessionStorage.setItem(`2faVerified_${uid}`, "true");
      logActivity({ userId: uid, username: userData?.username, name: userData?.name, action: "login" });
      return true;
    }
    return false;
  };

  const logout = async () => {
    const uid = auth.currentUser?.uid || user?.uid;
    if (uid) sessionStorage.removeItem(`2faVerified_${uid}`);
    if (uid) logActivity({ userId: uid, username: userData?.username, name: userData?.name, action: "logout" });
    await signOut(auth);
    setUser(null);
    setUserData(null);
    setPending2FA(false);
    setPendingSecret(null);
    setPendingUser(null);
  };

  // register accepts either object or legacy args
  const register = async (...args) => {
    let email, password, name, username, role, branches;
    if (args.length === 1 && typeof args[0] === "object") {
      ({ email, password, name, username, role, branches } = args[0]);
    } else {
      [email, password, name, role] = args;
      username = args[4] || null; // legacy fallback
    }
    role = role || "Employee";
    branches = Array.isArray(branches) ? branches : [];
    if (!email || !password || !name) throw new Error("Missing required fields");
    // username is required per new spec; generate from email if not provided (backward compat)
    if (!username) {
      username = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_.]/g, "");
    }
    username = username.toLowerCase().trim();
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
      throw new Error("Invalid username: 3-20 chars, alphanumeric + _ . only");
    }
    // Check username unique
    const taken = await isUsernameTaken(username);
    if (taken) throw new Error("Username already taken");

    // Use secondary app if admin is logged in to avoid signing out admin
    let creationAuth = auth;
    let secondaryApp = null;
    if (auth.currentUser) {
      secondaryApp = getApps().find((a) => a.name === "secondary");
      if (!secondaryApp) {
        secondaryApp = initializeApp(firebaseConfig, "secondary");
      }
      creationAuth = getAuth(secondaryApp);
    }

    const result = await createUserWithEmailAndPassword(creationAuth, email, password);
    // Save extra user data in Firestore
    try {
      // The /users doc and its /usernames/{username} lookup mirror (see
      // findEmailByUsername above) are written together in one batch so a
      // partial failure can never leave a user creatable but unable to
      // log in by username, or a username doc pointing at a half-created
      // account.
      const batch = writeBatch(db);
      batch.set(doc(db, "users", result.user.uid), {
        email: email.toLowerCase(),
        username,
        name,
        role,
        branches,
        totpSecret: null,
        totpEnabled: false,
        // Tracks whether this employee has been shown the "set up 2FA" prompt
        // yet, so it appears exactly once — right after their first login —
        // and never nags them again afterward, whether they set it up or
        // skipped it. See OtpSetupPrompt.
        otpPromptShown: false,
        createdAt: new Date().toISOString(),
      });
      batch.set(doc(db, "usernames", username), {
        email: email.toLowerCase(),
        uid: result.user.uid,
      });
      await batch.commit();
      // Bootstrap: the very first Admin account (created from the "first
      // time setup" screen, before any /users doc exists) is the only case
      // where a signed-in-but-not-yet-admin user is allowed to create their
      // own /users doc — see the Firestore rule's bootstrap exception. That
      // exception is gated on this flag doc not existing yet, so we create
      // it right after, permanently closing the door behind this one call.
      if (!auth.currentUser || auth.currentUser.uid === result.user.uid) {
        try {
          await setDoc(doc(db, "system", "bootstrap"), {
            createdAt: new Date().toISOString(),
            createdBy: result.user.uid,
          });
        } catch {}
      }
    } catch (firestoreError) {
      // Don't leave an orphan Auth account behind — without this, a failed
      // Firestore write (e.g. a rules issue) blocks every future retry with
      // "email-already-in-use" even though no usable account was created.
      try {
        await result.user.delete();
      } catch {}
      if (secondaryApp) {
        try {
          await signOut(creationAuth);
        } catch {}
      }
      throw firestoreError;
    }
    // If we used secondary auth, sign out from secondary to avoid lingering
    if (secondaryApp) {
      try {
        await signOut(creationAuth);
      } catch {}
    }
    return result;
  };

  const changePassword = async (currentPassword, newPassword) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) throw new Error("No authenticated user");
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
  };

  const generate2FASecret = () => generateTOTPSecret();

  const enable2FA = async (secret) => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("No authenticated user");
    const s = secret || pendingSecret;
    if (!s) throw new Error("Secret required");
    await updateDoc(doc(db, "users", currentUser.uid), {
      totpSecret: s,
      totpEnabled: true,
    });
    // Update local userData
    setUserData((prev) => (prev ? { ...prev, totpSecret: s, totpEnabled: true } : prev));
    sessionStorage.setItem(`2faVerified_${currentUser.uid}`, "true");
  };

  const disable2FA = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("No authenticated user");
    await updateDoc(doc(db, "users", currentUser.uid), {
      totpEnabled: false,
    });
    setUserData((prev) => (prev ? { ...prev, totpEnabled: false } : prev));
  };

  // Admin helpers for other users
  const enable2FAForUser = async (uid, secret) => {
    await updateDoc(doc(db, "users", uid), {
      totpSecret: secret,
      totpEnabled: true,
    });
  };

  const disable2FAForUser = async (uid) => {
    await updateDoc(doc(db, "users", uid), {
      totpEnabled: false,
    });
  };

  const updateUser = async (uid, data) => {
    // Need the CURRENT username/email to know which /usernames doc(s) to
    // touch — e.g. an email-only change still has to update the existing
    // username's mirror doc, or findEmailByUsername would keep resolving
    // to the old, no-longer-valid email and silently break that person's
    // login.
    const currentSnap = await getDoc(doc(db, "users", uid));
    const current = currentSnap.exists() ? currentSnap.data() : {};

    // If username is being changed, ensure unique and lowercase
    if (data.username) {
      data.username = data.username.toLowerCase().trim();
      if (!/^[a-z0-9_.]{3,20}$/.test(data.username)) {
        throw new Error("Invalid username format");
      }
      if (data.username !== current.username) {
        const taken = await isUsernameTaken(data.username, uid);
        if (taken) throw new Error("Username already taken");
      }
    }
    if (data.email) {
      data.email = data.email.toLowerCase().trim();
    }

    const newUsername = data.username || current.username;
    const newEmail = data.email || current.email;
    const batch = writeBatch(db);
    batch.update(doc(db, "users", uid), data);
    if (newUsername && (newUsername !== current.username || newEmail !== current.email)) {
      batch.set(doc(db, "usernames", newUsername), { email: newEmail, uid });
      if (current.username && current.username !== newUsername) {
        batch.delete(doc(db, "usernames", current.username));
      }
    }
    await batch.commit();
    if (uid === auth.currentUser?.uid) {
      setUserData((prev) => (prev ? { ...prev, ...data } : prev));
    }
  };

  // One-time migration helper: every account created BEFORE the
  // /usernames lookup mirror existed (see findEmailByUsername's comment
  // above) has no matching /usernames/{username} doc yet — without this,
  // upgrading to that fix would silently lock every existing employee out
  // of username-based login the moment it ships, since the lookup no
  // longer falls back to the old (vulnerable) /users query. Admin-only —
  // exposed as a button in Settings so whoever deploys this fix can run it
  // once; safe to run more than once (it only ever fills in what's
  // missing, in batches of ≤500 to stay under Firestore's per-batch cap).
  const backfillUsernameIndex = async () => {
    if (!isAdmin) throw new Error("Admin only");
    const snap = await getDocs(collection(db, "users"));
    const missing = [];
    for (const d of snap.docs) {
      const u = d.data();
      if (!u.username) continue; // pre-username-era account — nothing to index
      const uname = String(u.username).toLowerCase().trim();
      const existing = await getDoc(doc(db, "usernames", uname));
      if (!existing.exists()) missing.push({ username: uname, email: (u.email || "").toLowerCase(), uid: d.id });
    }
    for (let i = 0; i < missing.length; i += 500) {
      const batch = writeBatch(db);
      for (const m of missing.slice(i, i + 500)) {
        batch.set(doc(db, "usernames", m.username), { email: m.email, uid: m.uid });
      }
      await batch.commit();
    }
    return missing.length;
  };

  const hasPermission = (requiredRoles) => {
    if (!userData) return false;
    if (ADMIN_LEVEL_ROLES.includes(userData.role)) return true;
    return requiredRoles.includes(userData.role);
  };

  // Per-module access check: honors a user's manually-set customPermissions
  // (from Settings > Employees > Permissions) when present, otherwise falls
  // back to the module's default role list. Admin-level roles always pass.
  // A module a true Admin has globally switched off overrides everything
  // else, for everyone. See lib/permissions.js.
  const canAccessModule = (moduleKey) => canAccessModuleForUser(userData, moduleKey, isAdmin, appFeatures);

  // Global feature toggle — true Admin only. General Manager (though
  // otherwise Admin-level everywhere else in the app) is deliberately
  // excluded: this is the one lever only a real Admin can pull.
  const updateAppFeatures = async (updates) => {
    if (!isTrueAdmin) throw new Error("Only an Admin can change app features");
    await setDoc(doc(db, "settings", "appFeatures"), updates, { merge: true });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userData,
        loading,
        pending2FA,
        pendingSecret,
        pendingUser,
        login,
        loginWithUsernameOrEmail,
        verify2FA,
        verifyAndCompleteLogin,
        verifyTOTP,
        generateTOTPSecret,
        generate2FASecret,
        setup2FA,
        buildTOTPUrl,
        logout,
        register,
        changePassword,
        enable2FA,
        disable2FA,
        enable2FAForUser,
        disable2FAForUser,
        updateUser,
        backfillUsernameIndex,
        hasPermission,
        canAccessModule,
        branchesList,
        activeBranch,
        setActiveBranch,
        myBranches,
        isAdmin,
        isTrueAdmin,
        appFeatures,
        updateAppFeatures,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
