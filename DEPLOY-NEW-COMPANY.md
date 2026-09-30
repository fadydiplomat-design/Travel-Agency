# نشر التطبيق لشركة جديدة (Checklist)

**القاعدة الأساسية:** كل شركة = مشروع Firebase منفصل + نشر Vercel منفصل. الكود واحد ولا يتعدّل، والفرق كله في الـ Environment Variables.
لو شركتين استخدموا نفس مشروع Firebase هتتخلط بياناتهم.

## ١. إنشاء مشروع Firebase للشركة

1. [console.firebase.google.com](https://console.firebase.google.com) ← **Add project**.
2. **Authentication ← Get started ← Sign-in method** ← فعّل **Email/Password**.
3. **Firestore Database ← Create database** (اختار Production mode).
4. **Project settings (⚙️) ← General ← Your apps ← أيقونة `</>`** ← سجّل Web app، وانسخ قيم الـ `firebaseConfig`.
   - Storage مش مطلوب: شعار الشركة بيتخزن جوه Firestore نفسه.

## ٢. نشر قواعد الأمان (إجباري)

من غير القواعد دي قاعدة البيانات مش هتشتغل صح أو هتبقى مفتوحة.

**أسهل طريقة:** افتح ملف `firestore.rules` وانسخ محتواه كله ← Firebase Console ← **Firestore Database ← Rules** ← الصقه ← **Publish**.

**أو بالـ CLI:**
```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project PROJECT_ID
```

## ٣. النشر على Vercel

1. ارفع الكود على GitHub (ملف `.env.local` مش هيترفع، لأنه في `.gitignore`).
2. Vercel ← **Add New Project** ← اختار الـ repo.
3. **Framework Preset = Next.js**، وسيب **Output Directory** فاضي (من غير Override).
4. **Environment Variables**: ضيف القيم دي من `firebaseConfig`:

| المتغير | القيمة |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | `measurementId` (اختياري) |

5. **Deploy**. لو ناقص أي متغير مطلوب، الـ build هيفشل برسالة واضحة بتقولك أنهي متغير ناقص (ده مقصود، عشان التطبيق ماينفتحش على مشروع غلط).
6. **Firebase Console ← Authentication ← Settings ← Authorized domains** ← ضيف دومين Vercel (زي `company.vercel.app`) وأي دومين خاص.

## ٤. أول تشغيل

1. افتح الموقع، هتلاقي شاشة **Create your Admin account**. اعمل حساب الأدمن (اسم مستخدم + باسورد).
   الشاشة دي بتظهر مرة واحدة بس وبعدها بتتقفل نهائيًا.
2. **Settings ← Company Profile**: اكتب اسم الشركة وارفع الشعار وبيانات الاتصال. الاسم والشعار بيظهروا في القائمة الجانبية وفي كل مستند مطبوع.
3. **Settings ← Employees**: ضيف الموظفين وحدد صلاحياتهم.
4. زراير الإصلاح القديمة (Repair) اتشالت من الإعدادات، وتسجيل الدخول بيصلّح نفسه تلقائيًا.

## ٥. الترخيص (License / Kill-switch)

راجع `README-LICENSE.md`. اللي يهمك:
- مستند `system/license` (اختياري) بيقفل التطبيق كله لو `status` بقى `suspended` أو التاريخ انتهى.
- **أدمن الشركة** نفسه يقدر يغيّر الترخيص. لو عايز تحتفظ بتحكم مستقل، ضيف `isSuperAdmin: true` على مستند حسابك في `users` من Firebase Console.
- لو مشروع Firebase ملك الشركة، هي تقدر تعدّل أي حاجة فيه. لو عايز تفضل صاحب التحكم، يبقى المشروع تحت حسابك.

## ٦. قبل التسليم

- استبدل أيقونات التبويب: `app/icon.png` و `app/icon.svg` و `app/favicon.ico` (لو كانت بعلامة تجارية قديمة).
- جرّب: تسجيل دخول، إضافة عميل، إصدار فاتورة، طباعة فاتورة (تأكد إن الشعار والاسم ظاهرين).
- اعمل Backup من **Settings ← Backup** بعد ما تدخل أول بيانات.
