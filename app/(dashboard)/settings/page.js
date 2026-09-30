"use client";

import { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import { useAuth, ADMIN_LEVEL_ROLES, logActivity, forceSignOutUser, isUserOnline } from "@/lib/auth";
import { canViewLicenseStatus } from "@/lib/license";
import { CUSTOMIZABLE_MODULES, TOGGLEABLE_MODULES, defaultModulesForRole, defaultWriteModulesForRole } from "@/lib/permissions";
import ReportsTab from "@/components/ReportsTab";
import HistoryTab from "@/components/HistoryTab";
import BackupRestoreTab from "@/components/BackupRestoreTab";
import CompanyProfileTab from "@/components/CompanyProfileTab";
import LicensePanel from "@/components/LicensePanel";
import ResetNumberingPanel from "@/components/ResetNumberingPanel";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import toast from "react-hot-toast";
import {
  Plus,
  X,
  Search,
  Pencil,
  Trash2,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  Eye,
  EyeOff,
  User,
  Crown,
  Lock,
  QrCode,
  SlidersHorizontal,
  LogOut,
  History,
  LogIn,
  UserPlus,
  UserMinus,
  UserCog,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

const ROLES = ["Admin", "General Manager", "Manager", "Accountant", "Employee"];

export default function SettingsPage() {
  const {
    user,
    userData,
    hasPermission,
    canAccessModule,
    register,
    updateUser,
    verifyTOTP,
    generateTOTPSecret,
    enable2FA,
    disable2FA,
    changePassword,
    branchesList,
    isTrueAdmin,
    appFeatures,
    updateAppFeatures,
  } = useAuth();

  const [activeTab, setActiveTab] = useState("myAccount");

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [showEdit, setShowEdit] = useState(null); // user object
  const [showReset, setShowReset] = useState(null);
  const [show2FA_Admin, setShow2FA_Admin] = useState(null); // {user, secret, url, qr}
  const [showChangePw, setShowChangePw] = useState(false);
  const [showSelf2FA, setShowSelf2FA] = useState(null); // {secret, url, qr}
  const [showPermissions, setShowPermissions] = useState(null); // user object

  // Add form
  const [addForm, setAddForm] = useState({
    username: "",
    name: "",
    email: "",
    password: "",
    role: "Employee",
    require2FA: false,
    branches: [],
  });
  const [showAddPw, setShowAddPw] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  // Edit form
  const [editForm, setEditForm] = useState({ username: "", name: "", role: "Employee", branches: [] });
  const [editLoading, setEditLoading] = useState(false);

  // Branches management (new tab)
  const [branchForm, setBranchForm] = useState({ code: "", name: "" });
  const [editingBranch, setEditingBranch] = useState(null); // branch id being edited, or null
  const [branchSaving, setBranchSaving] = useState(false);

  // Reset pw form
  const [resetPw, setResetPw] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetPw, setShowResetPw] = useState(false);

  // 2FA verify code
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);

  // Change password self
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
  const [showPw1, setShowPw1] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [showPw3, setShowPw3] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  // Self 2FA code
  const [selfVerifyCode, setSelfVerifyCode] = useState("");

  // Manual permissions form: { enabled: bool, modules: { [key]: bool } }
  const [permForm, setPermForm] = useState({ enabled: false, modules: {}, writeModules: {}, onlyOwnData: false });
  const [permSaving, setPermSaving] = useState(false);

  const isAdmin = hasPermission(["Admin"]);
  const canSeeLicense = canViewLicenseStatus(userData);
  // Non-Admins can now be individually granted Reports and/or Backup access
  // (Settings > Employees > Permissions) — every other Settings tab stays
  // Admin-level-only. isAdmin already implies both, but we keep the
  // explicit check inline below for clarity at each usage site.
  const canReports = isAdmin || canAccessModule("reports");
  const canBackup = isAdmin || canAccessModule("backup");
  // General Manager has every other Admin-level permission except this one:
  // Admin accounts are invisible and unreachable to them in the Employees
  // list — only a true Admin can see or manage another Admin.
  const viewerIsTrueAdmin = userData?.role === "Admin";

  // Default landing tab: admins go straight to Employees when opening Settings.
  useEffect(() => {
    if (isAdmin) setActiveTab("employees");
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
        setUsers(data);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        toast.error("Failed to load users");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [isAdmin]);

  // Online/offline is derived from lastActiveAt vs. "now" — re-tick every
  // 20s purely to re-render so a user's badge flips to offline once their
  // heartbeat goes stale, even with no new Firestore data arriving.
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    if (activeTab !== "employees") return;
    const interval = setInterval(() => setPresenceTick((t) => t + 1), 20000);
    return () => clearInterval(interval);
  }, [activeTab]);

  const [featureSaving, setFeatureSaving] = useState(null); // moduleKey currently being toggled

  const handleToggleFeature = async (moduleKey, nextEnabled) => {
    setFeatureSaving(moduleKey);
    try {
      await updateAppFeatures({ [moduleKey]: nextEnabled });
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: nextEnabled ? "feature_enabled" : "feature_disabled",
        meta: { moduleKey },
      });
      toast.success(nextEnabled ? "Feature enabled" : "Feature disabled");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Failed to update feature");
    } finally {
      setFeatureSaving(null);
    }
  };

  const handleForceSignOut = async (u) => {
    if (u.id === user?.uid) {
      toast.error("You can't sign yourself out from here");
      return;
    }
    if (u.role === "Admin" && !viewerIsTrueAdmin) {
      toast.error("You're not authorized to manage this account");
      return;
    }
    if (!confirm(`Sign out "${u.name || u.username}" now? Their active session(s) will be ended.`)) return;
    try {
      await forceSignOutUser(u, userData);
      toast.success(`${u.name || u.username} will be signed out shortly`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to sign out user");
    }
  };

  const filteredUsers = useMemo(() => {
    const visible = viewerIsTrueAdmin ? users : users.filter((u) => u.role !== "Admin");
    if (!search.trim()) return visible;
    const q = search.toLowerCase();
    return visible.filter(
      (u) =>
        (u.username || "").toLowerCase().includes(q) ||
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
    );
  }, [users, search, viewerIsTrueAdmin]);

  // The employee currently selected in the table — the top toolbar's
  // action buttons (Edit / Permissions / Reset / 2FA / Sign Out / Delete)
  // act on this one, mirroring the same select-a-row-then-act pattern used
  // in Flights/Hotels/Visa/Transportation.
  const selectedEmployee = filteredUsers.find((u) => u.id === selectedEmployeeId) || null;

  // ---------- Add Employee ----------
  const handleAdd = async (e) => {
    e.preventDefault();
    const username = addForm.username.toLowerCase().trim();
    const name = addForm.name.trim();
    const password = addForm.password;
    const role = addForm.role;

    if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
      toast.error("Username must be 3-20 chars (a-z, 0-9, _ .)");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    // No email is collected in this form — Firebase Auth still needs *some*
    // email internally, so we derive an internal placeholder from the
    // username. It's never shown anywhere in the app.
    const email = `${username}@noemail.local`;
    // Check uniqueness locally first
    if (users.some((u) => u.username === username)) {
      toast.error("Username already taken");
      return;
    }

    // Every non-admin-level employee must belong to at least one branch, so
    // their data always stays scoped. Admin-level roles can optionally be
    // given branches too (used only as their default working branch) but
    // aren't required to.
    if (!ADMIN_LEVEL_ROLES.includes(role) && addForm.branches.length === 0) {
      toast.error("Select at least one branch for this employee");
      return;
    }

    setAddLoading(true);
    try {
      const result = await register({ email, password, name, username, role, branches: addForm.branches });
      // If require2FA, enable 2FA for new user
      if (addForm.require2FA && result?.user?.uid) {
        const secret = generateTOTPSecret();
        await updateDoc(doc(db, "users", result.user.uid), {
          totpSecret: secret,
          totpEnabled: true,
        });
        toast.success(`Employee created and 2FA enabled (secret: ${secret})`);
      } else {
        toast.success("Employee created successfully");
      }
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "employee_created",
        meta: { targetName: name, targetUsername: username, role },
      });
      setShowAdd(false);
      setAddForm({ username: "", name: "", email: "", password: "", role: "Employee", require2FA: false, branches: [] });
    } catch (err) {
      console.error(err);
      if (err.code === "auth/email-already-in-use") toast.error("Email already in use");
      else if (err.message?.includes("Username")) toast.error(err.message);
      else toast.error(err.message || "Failed to create employee");
    } finally {
      setAddLoading(false);
    }
  };

  // ---------- Edit ----------
  const openEdit = (u) => {
    if (u.role === "Admin" && !viewerIsTrueAdmin) {
      toast.error("You're not authorized to manage this account");
      return;
    }
    setShowEdit(u);
    setEditForm({
      username: u.username || "",
      name: u.name || "",
      role: u.role || "Employee",
      branches: u.branches || [],
    });
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    const username = editForm.username.toLowerCase().trim();
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
      toast.error("Invalid username format");
      return;
    }
    if (!ADMIN_LEVEL_ROLES.includes(editForm.role) && editForm.branches.length === 0) {
      toast.error("Select at least one branch for this employee");
      return;
    }
    setEditLoading(true);
    try {
      await updateUser(showEdit.id, {
        username,
        name: editForm.name.trim(),
        role: editForm.role,
        branches: editForm.branches,
      });
      toast.success("User updated");
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "employee_updated",
        meta: { targetUserId: showEdit.id, targetName: editForm.name.trim() },
      });
      setShowEdit(null);
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Update failed");
    } finally {
      setEditLoading(false);
    }
  };

  // ---------- Permissions (manual, per-employee, regardless of role) ----------
  const openPermissions = (u) => {
    const custom = u.customPermissions;
    const customWrite = u.customWritePermissions;
    if (custom && typeof custom === "object") {
      const modules = { ...custom };
      const writeModules =
        customWrite && typeof customWrite === "object"
          ? { ...customWrite }
          : Object.fromEntries(Object.entries(modules).filter(([, v]) => v).map(([k]) => [k, true]));
      setPermForm({ enabled: true, modules, writeModules, onlyOwnData: !!u.onlyOwnData });
    } else {
      // Not customized yet — prefill from what this role currently gets by
      // default, so the admin starts from the employee's real access.
      const modules = defaultModulesForRole(u.role);
      const writeModules = defaultWriteModulesForRole(u.role);
      setPermForm({ enabled: false, modules, writeModules, onlyOwnData: !!u.onlyOwnData });
    }
    setShowPermissions(u);
  };

  const handleSavePermissions = async (e) => {
    e.preventDefault();
    if (!showPermissions || permSaving) return;
    setPermSaving(true);
    try {
      await updateUser(showPermissions.id, {
        customPermissions: permForm.enabled ? permForm.modules : null,
        customWritePermissions: permForm.enabled ? permForm.writeModules : null,
        onlyOwnData: !!permForm.onlyOwnData,
      });
      toast.success("Permissions updated");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Failed to update permissions");
    } finally {
      setPermSaving(false);
    }
  };

  // ---------- Delete ----------
  const handleDelete = async (u) => {
    if (u.id === user?.uid) {
      toast.error("You cannot delete your own account");
      return;
    }
    if (u.role === "Admin" && !viewerIsTrueAdmin) {
      toast.error("You're not authorized to manage this account");
      return;
    }
    if (!confirm(`Delete user "${u.username || u.email}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, "users", u.id));
      // Note: Firebase Auth user still exists; deleting Firestore doc is primary for this app
      toast.success("User deleted (Firestore). Auth account may still exist.");
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "employee_deleted",
        meta: { targetName: u.name || u.username || u.email },
      });
      setSelectedEmployeeId((prev) => (prev === u.id ? null : prev));
    } catch (err) {
      console.error(err);
      toast.error("Delete failed");
    }
  };

  // ---------- Branches management ----------
  const handleAddBranch = async (e) => {
    e.preventDefault();
    const code = branchForm.code.trim();
    const name = branchForm.name.trim();
    if (!code || !name) {
      toast.error("Branch code and name are required");
      return;
    }
    if (!editingBranch && branchesList.some((b) => (b.code || "").toLowerCase() === code.toLowerCase())) {
      toast.error("Branch code already exists");
      return;
    }
    setBranchSaving(true);
    try {
      if (editingBranch) {
        await updateDoc(doc(db, "branches", editingBranch), { code, name });
        toast.success("Branch updated");
      } else {
        await addDoc(collection(db, "branches"), { code, name, createdAt: new Date().toISOString() });
        toast.success("Branch added");
      }
      setBranchForm({ code: "", name: "" });
      setEditingBranch(null);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save branch");
    } finally {
      setBranchSaving(false);
    }
  };

  const startEditBranch = (b) => {
    setEditingBranch(b.id);
    setBranchForm({ code: b.code || "", name: b.name || "" });
  };

  const cancelEditBranch = () => {
    setEditingBranch(null);
    setBranchForm({ code: "", name: "" });
  };

  const handleDeleteBranch = async (b) => {
    if (!confirm(`Delete branch "${b.name}" (${b.code})? Employees assigned to it will need to be reassigned.`)) return;
    try {
      await deleteDoc(doc(db, "branches", b.id));
      toast.success("Branch deleted");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete branch");
    }
  };


  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (showReset?.role === "Admin" && !viewerIsTrueAdmin) {
      toast.error("You're not authorized to manage this account");
      return;
    }
    if (resetPw.length < 6) {
      toast.error("Password must be 6+ chars");
      return;
    }
    setResetLoading(true);
    try {
      // We cannot directly update another user's Auth password client-side
      // (that needs the Admin SDK), so we flag the account and store a
      // temporary password the admin can hand to the employee directly.
      const target = showReset;
      await updateDoc(doc(db, "users", target.id), {
        passwordResetRequestedAt: new Date().toISOString(),
        mustChangePassword: true,
      });
      toast.success("Reset flag set successfully");
      // For demo, if admin wants to set new password directly, we store it as temporaryPassword (not secure, demo only)
      await updateDoc(doc(db, "users", target.id), {
        temporaryPassword: resetPw, // DEMO ONLY - in production use Firebase Admin SDK
      });
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "password_reset",
        meta: { targetUserId: target.id, targetName: target.name || target.username },
      });
      setShowReset(null);
      setResetPw("");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Reset failed");
    } finally {
      setResetLoading(false);
    }
  };

  // ---------- 2FA Admin Toggle ----------
  const handleToggle2FA = async (u) => {
    if (u.totpEnabled) {
      if (!confirm(`Disable 2FA for "${u.username}"?`)) return;
      try {
        await updateDoc(doc(db, "users", u.id), { totpEnabled: false });
        toast.success("2FA disabled");
        logActivity({
          userId: userData?.uid,
          username: userData?.username,
          name: userData?.name,
          action: "2fa_disabled",
          meta: { targetUserId: u.id, targetName: u.name || u.username },
        });
      } catch (err) {
        console.error(err);
        toast.error("Failed to disable 2FA");
      }
    } else {
      // Enable flow: generate secret + QR
      const secret = generateTOTPSecret();
      const totp = new OTPAuth.TOTP({
        issuer: "TravelAgency",
        label: u.username || u.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
      });
      const url = totp.toString();
      try {
        const qr = await QRCode.toDataURL(url);
        setShow2FA_Admin({ user: u, secret, url, qr });
        setVerifyCode("");
      } catch (err) {
        console.error(err);
        toast.error("Failed to generate QR");
      }
    }
  };

  const handleConfirmAdmin2FA = async (e) => {
    e.preventDefault();
    if (verifyCode.length !== 6) {
      toast.error("Enter 6-digit code");
      return;
    }
    const valid = verifyTOTP(verifyCode, show2FA_Admin.secret);
    if (!valid) {
      toast.error("Invalid code - check time sync");
      return;
    }
    setVerifyLoading(true);
    try {
      await updateDoc(doc(db, "users", show2FA_Admin.user.id), {
        totpSecret: show2FA_Admin.secret,
        totpEnabled: true,
      });
      toast.success(`2FA enabled for ${show2FA_Admin.user.username}`);
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "2fa_enabled",
        meta: { targetUserId: show2FA_Admin.user.id, targetName: show2FA_Admin.user.name || show2FA_Admin.user.username },
      });
      setShow2FA_Admin(null);
      setVerifyCode("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to enable 2FA");
    } finally {
      setVerifyLoading(false);
    }
  };

  // ---------- Self Change Password ----------
  const handleSelfChangePassword = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword.length < 6) {
      toast.error("New password must be 6+ chars");
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmNewPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setPwLoading(true);
    try {
      await changePassword(pwForm.currentPassword, pwForm.newPassword);
      toast.success("Password changed successfully");
      setShowChangePw(false);
      setPwForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
    } catch (err) {
      console.error(err);
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") toast.error("Current password incorrect");
      else if (err.code === "auth/weak-password") toast.error("Weak password");
      else toast.error(err.message || "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  };

  // ---------- Self 2FA ----------
  const handleSelf2FAInit = async () => {
    if (userData?.totpEnabled) {
      // Disable
      if (!confirm("Disable 2FA for your account?")) return;
      try {
        await disable2FA();
        toast.success("2FA disabled for your account");
      } catch (err) {
        console.error(err);
        toast.error("Failed to disable 2FA");
      }
      return;
    }
    const secret = generateTOTPSecret();
    const label = userData?.username || "user";
    const totp = new OTPAuth.TOTP({
      issuer: "TravelAgency",
      label,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const url = totp.toString();
    try {
      const qr = await QRCode.toDataURL(url);
      setShowSelf2FA({ secret, url, qr });
      setSelfVerifyCode("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate QR");
    }
  };

  const handleConfirmSelf2FA = async (e) => {
    e.preventDefault();
    if (selfVerifyCode.length !== 6) {
      toast.error("Enter 6-digit code");
      return;
    }
    const valid = verifyTOTP(selfVerifyCode, showSelf2FA.secret);
    if (!valid) {
      toast.error("Invalid code");
      return;
    }
    setVerifyLoading(true);
    try {
      await enable2FA(showSelf2FA.secret);
      toast.success("2FA enabled for your account!");
      setShowSelf2FA(null);
      setSelfVerifyCode("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to enable 2FA");
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div>
      <Navbar title={"Settings"} />

      <div className="p-6 space-y-6">
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6 -mb-px">
            {isAdmin && (
              <button
                onClick={() => setActiveTab("employees")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "employees"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Employees
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setActiveTab("permissions")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "permissions"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Permissions
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setActiveTab("branches")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "branches"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Branches
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setActiveTab("companyProfile")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "companyProfile"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Company Profile
              </button>
            )}
            {canBackup && (
              <button
                onClick={() => setActiveTab("backup")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "backup"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Backup
              </button>
            )}
            {isTrueAdmin && (
              <button
                onClick={() => setActiveTab("appFeatures")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "appFeatures"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                App Features
              </button>
            )}
            {canSeeLicense && (
              <button
                onClick={() => setActiveTab("license")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "license"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                License
              </button>
            )}
            {canReports && (
              <button
                onClick={() => setActiveTab("reports")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "reports"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Reports
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setActiveTab("history")}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === "history"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                History
              </button>
            )}
            <button
              onClick={() => setActiveTab("myAccount")}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
                activeTab === "myAccount"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              My Account
            </button>
          </nav>
        </div>

        {/* Tab content — cross-fades whenever activeTab changes (key
            forces a remount so the CSS entrance animation replays). */}
        <div key={activeTab} className="animate-tab-fade">

        {/* My Account Tab */}
        {activeTab === "myAccount" && (
          <MyAccountCard
            userData={userData}
            onChangePassword={() => setShowChangePw(true)}
            onToggle2FA={handleSelf2FAInit}
          />
        )}

        {/* Employees Tab - only Admin */}
        {activeTab === "employees" && isAdmin && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-5 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-gray-900">Employee Management</h3>
                <p className="text-sm text-gray-500">{filteredUsers.length} users • Manage accounts, roles & 2FA</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search username, name..."
                    className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64"
                  />
                </div>
                <button
                  onClick={() => {
                    setAddForm({ username: "", name: "", email: "", password: "", role: "Employee", require2FA: false, branches: [] });
                    setShowAdd(true);
                  }}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                >
                  <Plus size={18} /> Add Employee
                </button>
              </div>
            </div>

            {/* Action toolbar — select an employee row below, then act on
                them here (mirrors the toolbar pattern used across the
                booking pages) instead of a crowded per-row icon list. */}
            <div className="px-5 py-2.5 border-b border-gray-200 bg-slate-50 flex items-center gap-1.5 flex-wrap text-xs">
              <button
                onClick={() => selectedEmployee && openEdit(selectedEmployee)}
                disabled={!selectedEmployee}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700"
              >
                <Pencil size={13} /> Edit
              </button>
              {selectedEmployee && !ADMIN_LEVEL_ROLES.includes(selectedEmployee.role) && (
                <button
                  onClick={() => { openPermissions(selectedEmployee); setActiveTab("permissions"); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 text-indigo-600"
                >
                  <SlidersHorizontal size={13} /> Permissions
                </button>
              )}
              <button
                onClick={() => { if (selectedEmployee) { setShowReset(selectedEmployee); setResetPw(""); } }}
                disabled={!selectedEmployee}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-amber-600"
              >
                <KeyRound size={13} /> Reset Password
              </button>
              <button
                onClick={() => selectedEmployee && handleToggle2FA(selectedEmployee)}
                disabled={!selectedEmployee}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed ${selectedEmployee?.totpEnabled ? "text-emerald-600" : "text-gray-600"}`}
              >
                {selectedEmployee?.totpEnabled ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                {selectedEmployee?.totpEnabled ? "Disable 2FA" : "Enable 2FA"}
              </button>
              {selectedEmployee && isUserOnline(selectedEmployee) && selectedEmployee.id !== user?.uid && (
                <button
                  onClick={() => handleForceSignOut(selectedEmployee)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-200 bg-white hover:bg-orange-50 text-orange-600"
                >
                  <LogOut size={13} /> Sign Out Now
                </button>
              )}
              <span className="flex-1" />
              <button
                onClick={() => selectedEmployee && handleDelete(selectedEmployee)}
                disabled={!selectedEmployee}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed text-red-600"
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>

            {loading ? (
              <div className="p-12 text-center text-gray-400">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                Loading users...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-12 text-center text-gray-500">No users found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>2FA</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr
                        key={u.id}
                        onClick={() => setSelectedEmployeeId(u.id)}
                        className={`cursor-pointer hover:bg-gray-50 ${selectedEmployeeId === u.id ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
                      >
                        <td>
                          <span className="font-mono text-sm font-medium text-gray-900">@{u.username || "-"}</span>
                        </td>
                        <td className="font-medium text-gray-900">{u.name || "-"}</td>
                        <td>
                          <span
                            className={`badge ${
                              u.role === "Admin"
                                ? "badge-blue"
                                : u.role === "General Manager"
                                ? "badge-purple"
                                : u.role === "Manager"
                                ? "badge-yellow"
                                : u.role === "Accountant"
                                ? "badge-green"
                                : "badge-gray"
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td>
                          {u.totpEnabled ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full text-xs font-medium">
                              <ShieldCheck size={12} /> Enabled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-gray-500 bg-gray-100 px-2 py-1 rounded-full text-xs">
                              <ShieldOff size={12} /> Disabled
                            </span>
                          )}
                        </td>
                        <td>
                          {isUserOnline(u) ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full text-xs font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Online
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-gray-500 bg-gray-100 px-2 py-1 rounded-full text-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                              Offline
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Permissions Tab - only Admin */}
        {activeTab === "permissions" && isAdmin && (
          <PermissionsTab
            users={users.filter((u) => !ADMIN_LEVEL_ROLES.includes(u.role))}
            selectedUser={showPermissions}
            form={permForm}
            setForm={setPermForm}
            onSelectUser={(u) => (u ? openPermissions(u) : setShowPermissions(null))}
            onSubmit={handleSavePermissions}
            saving={permSaving}
          />
        )}

        {/* Branches Tab - only Admin */}
        {activeTab === "branches" && isAdmin && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-5 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Branch Management</h3>
              <p className="text-sm text-gray-500">
                Each branch works fully independently — its own reg numbers, invoice numbers, and data.
                Assign employees to a branch under the Employees tab.
              </p>
            </div>
            <div className="p-5 border-b border-gray-200 bg-gray-50">
              <form onSubmit={handleAddBranch} className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">Branch Code</label>
                  <input
                    required
                    value={branchForm.code}
                    onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
                    placeholder="e.g. cairo"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">Branch Name</label>
                  <input
                    required
                    value={branchForm.name}
                    onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                    placeholder="e.g. Cairo Branch"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={branchSaving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    <Plus size={16} /> {editingBranch ? "Save" : "Add Branch"}
                  </button>
                  {editingBranch && (
                    <button type="button" onClick={cancelEditBranch} className="px-4 py-2 border rounded-lg text-sm">
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Code</th>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {branchesList.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-gray-400">
                        No branches yet. Add one above.
                      </td>
                    </tr>
                  )}
                  {branchesList.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-3 font-mono">{b.code}</td>
                      <td className="px-4 py-3">{b.name}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => startEditBranch(b)} title="Edit" className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleDeleteBranch(b)} title="Delete" className="p-1.5 hover:bg-red-50 rounded-lg text-red-600">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "license" && canSeeLicense && (
          <div className="max-w-lg space-y-6">
            <LicensePanel variant="light" />
            {isAdmin && <ResetNumberingPanel />}
          </div>
        )}

        {activeTab === "appFeatures" && isTrueAdmin && (
          <div className="bg-white rounded-xl border border-gray-200 max-w-2xl">
            <div className="px-6 py-4 border-b">
              <h3 className="font-semibold text-gray-900">App Features</h3>
              <p className="text-sm text-gray-500">
                Turn any module off for the whole company. Applies to everyone — including General
                Manager — until you turn it back on. Only an Admin can see or change this.
              </p>
            </div>
            <div className="divide-y">
              {TOGGLEABLE_MODULES.map((m) => {
                const enabled = appFeatures?.[m.key] !== false;
                const saving = featureSaving === m.key;
                return (
                  <div key={m.key} className="flex items-center justify-between px-6 py-4">
                    <div>
                      <p className="font-medium text-gray-900">{m.label}</p>
                      <p className="text-xs text-gray-400">{m.href}</p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleToggleFeature(m.key, !enabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
                        enabled ? "bg-blue-600" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "reports" && canReports && <ReportsTab />}

        {activeTab === "history" && isAdmin && <HistoryTab />}

        {activeTab === "companyProfile" && isAdmin && <CompanyProfileTab />}

        {activeTab === "backup" && canBackup && <BackupRestoreTab />}

        </div>
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto animate-modal-panel">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white rounded-t-xl">
              <h3 className="font-semibold text-lg">Add Employee</h3>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setAddForm({ username: "", name: "", email: "", password: "", role: "Employee", require2FA: false, branches: [] });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4" autoComplete="off">
              <div>
                <label className="block text-sm font-medium mb-1">Full Name *</label>
                <input
                  required
                  name="new-employee-name"
                  autoComplete="off"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Username *</label>
                <input
                  required
                  name="new-employee-username"
                  autoComplete="off"
                  value={addForm.username}
                  onChange={(e) => setAddForm({ ...addForm, username: e.target.value.toLowerCase() })}
                  placeholder="john_doe"
                  pattern="[a-z0-9_.]{3,20}"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">3-20 chars, lowercase, alphanumeric + _ .</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password *</label>
                <div className="relative">
                  <input
                    required
                    type={showAddPw ? "text" : "password"}
                    name="new-employee-password"
                    autoComplete="new-password"
                    value={addForm.password}
                    onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                    minLength={6}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddPw(!showAddPw)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showAddPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role *</label>
                <select
                  value={addForm.role}
                  onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Branches {!ADMIN_LEVEL_ROLES.includes(addForm.role) && "*"}</label>
                <div className="border rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
                  {branchesList.length === 0 && <p className="text-xs text-gray-400">No branches yet — add one in the Branches tab first.</p>}
                  {branchesList.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addForm.branches.includes(b.code)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...addForm.branches, b.code]
                            : addForm.branches.filter((c) => c !== b.code);
                          setAddForm({ ...addForm, branches: next });
                        }}
                        className="rounded"
                      />
                      {b.name} <span className="text-gray-400 font-mono text-xs">({b.code})</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {ADMIN_LEVEL_ROLES.includes(addForm.role)
                    ? "Admins and General Managers can always see every branch — this just sets their default working branch."
                    : "This employee will only ever see data for the branch(es) checked here."}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={addForm.require2FA}
                  onChange={(e) => setAddForm({ ...addForm, require2FA: e.target.checked })}
                  className="rounded"
                />
                Require 2FA on next login (enable immediately)
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdd(false);
                    setAddForm({ username: "", name: "", email: "", password: "", role: "Employee", require2FA: false, branches: [] });
                  }}
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {addLoading ? "Creating..." : "Create Employee"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl animate-modal-panel">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-lg">Edit User</h3>
              <button onClick={() => setShowEdit(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Username</label>
                <input
                  required
                  value={editForm.username}
                  onChange={(e) => setEditForm({ ...editForm, username: e.target.value.toLowerCase() })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Full Name</label>
                <input
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Branches {!ADMIN_LEVEL_ROLES.includes(editForm.role) && "*"}</label>
                <div className="border rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
                  {branchesList.length === 0 && <p className="text-xs text-gray-400">No branches yet — add one in the Branches tab first.</p>}
                  {branchesList.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.branches.includes(b.code)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...editForm.branches, b.code]
                            : editForm.branches.filter((c) => c !== b.code);
                          setEditForm({ ...editForm, branches: next });
                        }}
                        className="rounded"
                      />
                      {b.name} <span className="text-gray-400 font-mono text-xs">({b.code})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEdit(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {editLoading ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl animate-modal-panel">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-lg">Reset Password - @{showReset.username}</h3>
              <button onClick={() => setShowReset(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              <p className="text-sm text-gray-500">
                Set a temporary password for <b>@{showReset.username}</b>. User should change it on next login.
              </p>
              <div>
                <label className="block text-sm font-medium mb-1">New Password</label>
                <div className="relative">
                  <input
                    required
                    type={showResetPw ? "text" : "password"}
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                    minLength={6}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPw(!showResetPw)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showResetPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Stored as temporaryPassword (demo). Production: use Admin SDK.</p>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowReset(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 disabled:opacity-60"
                >
                  {resetLoading ? "Saving..." : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin 2FA Enable Modal */}
      {show2FA_Admin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl animate-modal-panel">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <QrCode size={18} /> Enable 2FA - @{show2FA_Admin.user.username}
              </h3>
              <button onClick={() => setShow2FA_Admin(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleConfirmAdmin2FA} className="p-6 space-y-4">
              <p className="text-sm text-gray-600">Scan QR with Google Authenticator, then enter 6-digit code to confirm.</p>
              <div className="flex justify-center bg-gray-50 p-4 rounded-xl">
                <img src={show2FA_Admin.qr} alt="QR Code" className="w-48 h-48" />
              </div>
              <div className="bg-gray-50 p-3 rounded-lg text-center">
                <p className="text-xs text-gray-500">Secret (manual entry)</p>
                <p className="font-mono text-sm font-medium break-all select-all">{show2FA_Admin.secret}</p>
                <p className="text-xs text-gray-400 mt-1">otpauth URL: {show2FA_Admin.url.slice(0, 60)}...</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">6-digit code</label>
                <input
                  required
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  placeholder="000000"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center text-xl tracking-[0.5em] font-mono"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShow2FA_Admin(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifyLoading}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-60"
                >
                  {verifyLoading ? "Verifying..." : "Verify & Enable"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Self Change Password Modal */}
      {showChangePw && (
        <ChangePasswordModal
          pwForm={pwForm}
          setPwForm={setPwForm}
          onSubmit={handleSelfChangePassword}
          onClose={() => setShowChangePw(false)}
          loading={pwLoading}
          showPw1={showPw1}
          setShowPw1={setShowPw1}
          showPw2={showPw2}
          setShowPw2={setShowPw2}
          showPw3={showPw3}
          setShowPw3={setShowPw3}
        />
      )}

      {/* Self 2FA Modal */}
      {showSelf2FA && (
        <Self2FAModal
          data={showSelf2FA}
          code={selfVerifyCode}
          setCode={setSelfVerifyCode}
          onConfirm={handleConfirmSelf2FA}
          onClose={() => setShowSelf2FA(null)}
          loading={verifyLoading}
        />
      )}

    </div>
  );
}

function MyAccountCard({ userData, onChangePassword, onToggle2FA }) {
  if (!userData) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex gap-4">
          <div className="w-14 h-14 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center flex-shrink-0">
            <User size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              My Account
              {userData.role !== "Employee" && (
                <span className="inline-flex items-center gap-1 bg-slate-800 text-white text-xs px-2 py-0.5 rounded-full">
                  <Crown size={10} /> {userData.role}
                </span>
              )}
            </h3>
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <p className="flex items-center gap-2">
                <User size={14} className="text-gray-400" /> <span className="font-mono">@{userData.username || "-"}</span>
              </p>
              <p className="flex items-center gap-2">
                {userData.totpEnabled ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full text-xs font-medium">
                    <ShieldCheck size={12} /> 2FA Enabled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-gray-500 bg-gray-100 px-2 py-1 rounded-full text-xs">
                    <ShieldOff size={12} /> 2FA Disabled
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onChangePassword}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition"
          >
            <Lock size={16} /> Change Password
          </button>
          <button
            onClick={onToggle2FA}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              userData.totpEnabled
                ? "bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-200"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            {userData.totpEnabled ? (
              <>
                <ShieldOff size={16} /> Disable 2FA
              </>
            ) : (
              <>
                <ShieldCheck size={16} /> Setup Google Authenticator
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangePasswordModal({ pwForm, setPwForm, onSubmit, onClose, loading, showPw1, setShowPw1, showPw2, setShowPw2, showPw3, setShowPw3 }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl animate-modal-panel">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Lock size={18} /> Change Password
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Current Password</label>
            <div className="relative">
              <input
                required
                type={showPw1 ? "text" : "password"}
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw1(!showPw1)} className="absolute right-3 top-2.5 text-gray-400">
                {showPw1 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">New Password</label>
            <div className="relative">
              <input
                required
                type={showPw2 ? "text" : "password"}
                value={pwForm.newPassword}
                onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                minLength={6}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw2(!showPw2)} className="absolute right-3 top-2.5 text-gray-400">
                {showPw2 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirm New Password</label>
            <div className="relative">
              <input
                required
                type={showPw3 ? "text" : "password"}
                value={pwForm.confirmNewPassword}
                onChange={(e) => setPwForm({ ...pwForm, confirmNewPassword: e.target.value })}
                minLength={6}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw3(!showPw3)} className="absolute right-3 top-2.5 text-gray-400">
                {showPw3 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
              {loading ? "Updating..." : "Update Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Self2FAModal({ data, code, setCode, onConfirm, onClose, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl animate-modal-panel">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <QrCode size={18} /> Setup Google Authenticator
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onConfirm} className="p-6 space-y-4">
          <p className="text-sm text-gray-600">Scan this QR with Google Authenticator, then enter code to verify.</p>
          <div className="flex justify-center bg-gray-50 p-4 rounded-xl">
            <img src={data.qr} alt="QR Code" className="w-48 h-48" />
          </div>
          <div className="bg-gray-50 p-3 rounded-lg text-center">
            <p className="text-xs text-gray-500">Secret</p>
            <p className="font-mono text-sm font-medium break-all select-all">{data.secret}</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">6-digit code</label>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              placeholder="000000"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center text-xl tracking-[0.5em] font-mono"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-60">
              {loading ? "Verifying..." : "Verify & Enable"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PermissionsTab({ users, selectedUser, form, setForm, onSelectUser, onSubmit, saving }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 max-w-2xl">
      <div className="px-6 py-4 border-b">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <SlidersHorizontal size={18} /> Employee Permissions
        </h3>
        <p className="text-sm text-gray-500">Pick an employee, then set Read/Write access per page.</p>
      </div>

      <div className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Employee</label>
          <select
            value={selectedUser?.id || ""}
            onChange={(e) => {
              const u = users.find((x) => x.id === e.target.value) || null;
              onSelectUser(u);
            }}
            className="w-full max-w-sm px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          >
            <option value="">Select an employee...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.username} — {u.role}
              </option>
            ))}
          </select>
        </div>

        {!selectedUser && (
          <p className="text-sm text-gray-400 py-6 text-center border border-dashed rounded-lg">
            Select an employee above to view or edit their permissions.
          </p>
        )}

        {selectedUser && (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="flex items-start gap-2 text-sm font-medium bg-amber-50 border border-amber-200 rounded-lg p-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!form.onlyOwnData}
                onChange={(e) => setForm({ ...form, onlyOwnData: e.target.checked })}
              />
              <span>
                Only see own work
                <span className="block font-normal text-xs text-gray-500 mt-0.5">
                  Restricts Flights, Hotels, Visa and Transportation to bookings where this employee is the
                  salesman — they won't see records entered by other employees, even in their own branch.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm font-medium bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              <span>
                Use custom permissions for this employee
                <span className="block font-normal text-xs text-gray-500 mt-0.5">
                  Overrides the default pages for the "{selectedUser.role}" role — only the pages checked below will
                  be visible to this employee.
                </span>
              </span>
            </label>

            {!form.enabled && (
              <p className="text-xs text-gray-500">
                Currently following the default pages for the "{selectedUser.role}" role. Check the box above to set
                custom access for this employee.
              </p>
            )}

            <div className={`border border-gray-200 rounded-lg ${!form.enabled ? "opacity-50 pointer-events-none" : ""}`}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-xs font-medium text-gray-500">Page</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-medium text-gray-500 w-12 text-center">Read</span>
                  <span className="text-xs font-medium text-gray-500 w-12 text-center">Write</span>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                {CUSTOMIZABLE_MODULES.map((m) => {
                  const canRead = !!form.modules[m.key];
                  const canWrite = !!form.writeModules[m.key];
                  return (
                    <div key={m.key} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span>{m.label}</span>
                      <div className="flex items-center gap-4">
                        <input
                          type="checkbox"
                          className="w-12"
                          checked={canRead}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setForm({
                              ...form,
                              modules: { ...form.modules, [m.key]: checked },
                              // Turning Read off makes Write meaningless too
                              // (no page = nothing to write to) — clear it so
                              // the checkbox reflects reality, not a stale value.
                              writeModules: checked ? form.writeModules : { ...form.writeModules, [m.key]: false },
                            });
                          }}
                        />
                        <input
                          type="checkbox"
                          className="w-12"
                          checked={canRead && canWrite}
                          disabled={!canRead}
                          title={!canRead ? "Enable Read first" : undefined}
                          onChange={(e) => setForm({ ...form, writeModules: { ...form.writeModules, [m.key]: e.target.checked } })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Read only (Write off) lets the employee open and view a page without adding, editing, or deleting anything in it.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? "Saving..." : "Save Permissions"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
