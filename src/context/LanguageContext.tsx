import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Language = 'en' | 'ar';

interface Translations {
  [key: string]: {
    [key: string]: string;
  };
}

const translations: Translations = {
  en: {
    // Navbar
    navSession: 'WhatsApp Session',
    navSingleMessage: 'Single Messaging',
    navBulkBroadcast: 'Bulk Broadcast',
    navUserManagement: 'User Management',
    navReports: 'Reports & Logs',
    changePassword: 'Change Password',
    logout: 'Logout',
    language: 'Language',
    // Login
    loginHeader: 'MFF WhatsApp',
    loginSub: 'Enterprise Authentication',
    email: 'Email Address',
    password: 'Password',
    signIn: 'Sign In',
    authenticating: 'Authenticating...',
    // Modals
    newPassword: 'New Password',
    confirmReset: 'Confirm Reset',
    cancel: 'Cancel',
    passwordSuccess: 'Password updated successfully',
    passwordError: 'Failed to update password',
    // Admin / User Management
    createUser: 'Create User',
    displayName: 'Display Name',
    department: 'Department',
    role: 'Role',
    addUser: 'Add User',
    userDirectory: 'User Directory',
    actions: 'Actions',
    superAdmin: 'Super Admin',
    teamLeader: 'Team Leader',
    agent: 'Agent',
    deptManager: 'Department Manager',
    assignTeamLeader: 'Assign to Team Leader',
    selectTeamLeader: 'Select Team Leader...',
    none: 'None / Independent',
    assignedLeader: 'Team Leader',
    status: 'Status',
    active: 'Active',
    resetPassword: 'Reset Password',
    deleteUser: 'Delete',
    confirmDelete: 'Are you sure you want to delete this user?',
    userCreated: 'User created successfully',
    // Permissions
    featurePermissions: 'Feature Permissions',
    allowSingleMessaging: 'Allow Single Messaging',
    allowBulkBroadcast: 'Allow Bulk Broadcast',
    permissions: 'Permissions',
    editUser: 'Edit User',
    saveChanges: 'Save Changes',
    userUpdated: 'User updated successfully',
    accessDenied: 'Access Denied',
    noSinglePermission: 'Access Denied: You do not have permission to send single messages.',
    noBulkPermission: 'Access Denied: You do not have permission to run bulk broadcasts.',
    singleMsgBadge: 'Single Msg',
    bulkBroadcastBadge: 'Bulk Broadcast',
    // Dashboard
    yourSession: 'Your Session',
    manageSession: 'Manage your isolated WhatsApp connection',
    connectionStatus: 'Connection Status',
    startSession: 'Start Session',
    disconnect: 'Disconnect',
    resetSession: 'Reset / Re-scan QR',
    scanQR: 'Scan with WhatsApp to link your isolated session.',
    initializing: 'Initializing...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting...',
    scanNewQR: 'Scan New QR Code',
    reconnectSaved: 'Try Reconnect Saved Session',
    resetSessionState: 'Reset Session to Idle',
    generateMyQR: 'Generate My QR Code',
    disconnectMySession: 'Disconnect My Session',
    connectedAs: 'Connected as',
    generatingQR: 'Generating QR Code...',
    sessionIsolatedDesc: 'Your WhatsApp session is completely private and isolated to your account.',
    sessionIdleDesc: 'No active session. Click "Generate My QR Code" to link your WhatsApp account.',
    reconnectFailedDesc: 'Saved session reconnection did not complete. A fresh QR code is ready below.',
    // Single Message
    sendSingleMessage: 'Send Single Message',
    recipientPhone: 'Recipient Phone Number (with Country Code)',
    messageContent: 'Message Content',
    typeMessagePlaceholder: 'Type your message here...',
    sendMessage: 'Send Message',
    sending: 'Sending...',
    messageSentSuccess: 'Message sent successfully!',
    // Bulk Broadcast / Campaign
    bulkBroadcast: 'Bulk Broadcast',
    campaignEngine: 'Campaign Engine',
    campaignName: 'Campaign Name',
    campaignNamePlaceholder: 'e.g., Monthly Statement Notification',
    uploadCSV: 'Upload CSV File',
    downloadSampleCSV: 'Download Sample CSV',
    dropCSVHere: 'Click or drag & drop CSV here',
    csvSupportedCols: 'Columns: Phone, Message (UTF-8 format)',
    contactsLoaded: 'contacts loaded from CSV',
    messageTemplate: 'Message Template (fallback for contacts without custom message)',
    messageTemplatePlaceholder: 'Hello! Your monthly invoice is ready...',
    delaySeconds: 'Delay Between Messages (seconds)',
    startCampaign: 'Start Campaign Queue',
    startNewCampaign: 'Start New Campaign',
    clearData: 'Clear Data',
    viewResetSuccess: 'View reset. You can now start a fresh batch upload.',
    pauseCampaign: 'Pause',
    resumeCampaign: 'Resume',
    cancelCampaign: 'Stop Campaign',
    campaignStatus: 'Campaign Status',
    progress: 'Progress',
    totalContacts: 'Total Contacts',
    sent: 'Sent',
    failed: 'Failed',
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    cancelled: 'Stopped',
    activeCampaignFound: 'Active Campaign in Progress',
    // Reports & Analytics
    analyticsTitle: 'Analytics & Delivery Reports',
    totalSent: 'Total Sent',
    totalFailed: 'Total Failed',
    deliveryRate: 'Delivery Rate',
    activeConnections: 'Active Sessions',
    timeRange: 'Date Range',
    today: 'Today',
    last7Days: 'Last 7 Days',
    customRange: 'Custom Range',
    allTime: 'All Time',
    statusFilter: 'Status Filter',
    allStatuses: 'All Statuses',
    agentBreakdown: 'Performance by Agent',
    auditLogs: 'Message Delivery Logs',
    phone: 'Phone',
    recipient: 'Recipient',
    timestamp: 'Timestamp',
    campaign: 'Campaign',
    noLogsFound: 'No message logs found for this filter.'
  },
  ar: {
    // Navbar
    navSession: 'جلسة واتساب',
    navSingleMessage: 'رسالة فردية',
    navBulkBroadcast: 'بث جماعي',
    navUserManagement: 'إدارة المستخدمين',
    navReports: 'التقارير والسجلات',
    changePassword: 'تغيير كلمة المرور',
    logout: 'تسجيل الخروج',
    language: 'اللغة',
    // Login
    loginHeader: 'واتساب MFF',
    loginSub: 'تسجيل الدخول للمؤسسة',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    signIn: 'تسجيل الدخول',
    authenticating: 'جاري التحقق...',
    // Modals
    newPassword: 'كلمة المرور الجديدة',
    confirmReset: 'تأكيد التغيير',
    cancel: 'إلغاء',
    passwordSuccess: 'تم تحديث كلمة المرور بنجاح',
    passwordError: 'فشل في تحديث كلمة المرور',
    // Admin / User Management
    createUser: 'إنشاء مستخدم',
    displayName: 'الاسم المعروض',
    department: 'القسم',
    role: 'الصلاحية',
    addUser: 'إضافة مستخدم',
    userDirectory: 'دليل المستخدمين',
    actions: 'إجراءات',
    superAdmin: 'مدير عام (Super Admin)',
    teamLeader: 'قائد فريق (Team Leader)',
    agent: 'موظف (Agent)',
    deptManager: 'مدير قسم',
    assignTeamLeader: 'تعيين لقائد الفريق',
    selectTeamLeader: 'اختر قائد الفريق...',
    none: 'بدون / مستقل',
    assignedLeader: 'قائد الفريق',
    status: 'الحالة',
    active: 'نشط',
    resetPassword: 'إعادة ضبط كلمة المرور',
    deleteUser: 'حذف',
    confirmDelete: 'هل أنت متأكد من رغبتك في حذف هذا المستخدم؟',
    userCreated: 'تم إنشاء المستخدم بنجاح',
    // Permissions
    featurePermissions: 'صلاحيات الميزات',
    allowSingleMessaging: 'السماح بالرسائل الفردية',
    allowBulkBroadcast: 'السماح بالبث الجماعي',
    permissions: 'الصلاحيات',
    editUser: 'تعديل المستخدم',
    saveChanges: 'حفظ التغييرات',
    userUpdated: 'تم تحديث بيانات المستخدم بنجاح',
    accessDenied: 'تم رفض الوصول',
    noSinglePermission: 'تم رفض الوصول: ليس لديك صلاحية لإرسال رسائل فردية.',
    noBulkPermission: 'تم رفض الوصول: ليس لديك صلاحية لتشغيل البث الجماعي.',
    singleMsgBadge: 'رسائل فردية',
    bulkBroadcastBadge: 'بث جماعي',
    // Dashboard
    yourSession: 'جلستك',
    manageSession: 'إدارة اتصال واتساب الخاص بك',
    connectionStatus: 'حالة الاتصال',
    startSession: 'بدء الجلسة',
    disconnect: 'قطع الاتصال',
    resetSession: 'إعادة تعيين / مسح الرمز',
    scanQR: 'امسح الرمز باستخدام واتساب لربط جلستك.',
    initializing: 'جاري التهيئة...',
    connected: 'متصل',
    disconnected: 'غير متصل',
    reconnecting: 'جاري إعادة الاتصال...',
    scanNewQR: 'مسح رمز QR جديد',
    reconnectSaved: 'محاولة إعادة ربط الجلسة المحفوظة',
    resetSessionState: 'إعادة ضبط الجلسة إلى الخمول',
    generateMyQR: 'توليد رمز الاستجابة السريعة (QR)',
    disconnectMySession: 'قطع اتصال جلستي',
    connectedAs: 'متصل برقم',
    generatingQR: 'جاري توليد الرمز...',
    sessionIsolatedDesc: 'جلسة واتساب الخاصة بك معزولة ومحمية بالكامل لحسابك فقط.',
    sessionIdleDesc: 'لا توجد جلسة نشطة. اضغط على "توليد رمز الاستجابة السريعة (QR)" لربط حساب واتساب الخاص بك.',
    reconnectFailedDesc: 'تعذر الاتصال بالجلسة المحفوظة. تم تجهيز رمز QR جديد أدناه.',
    // Single Message
    sendSingleMessage: 'إرسال رسالة فردية',
    recipientPhone: 'رقم هاتف المستلم (مع رمز الدولة)',
    messageContent: 'نص الرسالة',
    typeMessagePlaceholder: 'اكتب نص رسالتك هنا...',
    sendMessage: 'إرسال الرسالة',
    sending: 'جاري الإرسال...',
    messageSentSuccess: 'تم إرسال الرسالة بنجاح!',
    // Bulk Broadcast / Campaign
    bulkBroadcast: 'البث الجماعي',
    campaignEngine: 'محرك الحملات البريدية',
    campaignName: 'اسم الحملة',
    campaignNamePlaceholder: 'مثال: إشعار الكشف الشهري',
    uploadCSV: 'رفع ملف CSV',
    downloadSampleCSV: 'تحميل نموذج CSV',
    dropCSVHere: 'اضغط أو اسحب ملف CSV إلى هنا',
    csvSupportedCols: 'الأعمدة المدعومة: Phone, Message (ترميز UTF-8)',
    contactsLoaded: 'جهة اتصال تم تحميلها من الملف',
    messageTemplate: 'قالب الرسالة (للأرقام بدون رسالة مخصصة)',
    messageTemplatePlaceholder: 'مرحباً! كشف حسابكم الشهري جاهز...',
    delaySeconds: 'التأخير بين الرسائل (بالثواني)',
    startCampaign: 'بدء طابور الحملة',
    startNewCampaign: 'بدء حملة جديدة',
    clearData: 'مسح البيانات',
    viewResetSuccess: 'تم مسح العرض. يمكنك الآن بدء رفع دفعة جديدة.',
    pauseCampaign: 'إيقاف مؤقت',
    resumeCampaign: 'استئناف',
    cancelCampaign: 'إلغاء الحملة',
    campaignStatus: 'حالة الحملة',
    progress: 'نسبة الإنجاز',
    totalContacts: 'إجمالي جهات الاتصال',
    sent: 'تم الإرسال',
    failed: 'فشل',
    running: 'قيد التشغيل',
    paused: 'متوقفة مؤقتاً',
    completed: 'مكتملة',
    cancelled: 'ملغاة',
    activeCampaignFound: 'يوجد حملة جارية حالياً',
    // Reports & Analytics
    analyticsTitle: 'التحليلات وتقارير التسليم',
    totalSent: 'إجمالي المرسل',
    totalFailed: 'إجمالي الفاشل',
    deliveryRate: 'نسبة النجاح',
    activeConnections: 'الجلسات النشطة',
    timeRange: 'النطاق الزمني',
    today: 'اليوم',
    last7Days: 'آخر 7 أيام',
    customRange: 'نطاق مخصص',
    allTime: 'كل الأوقات',
    statusFilter: 'فلترة الحالة',
    allStatuses: 'جميع الحالات',
    agentBreakdown: 'الأداء حسب الموظف',
    auditLogs: 'سجلات تدقيق الرسائل',
    phone: 'رقم الهاتف',
    recipient: 'المستلم',
    timestamp: 'التاريخ والوقت',
    campaign: 'الحملة',
    noLogsFound: 'لا توجد سجلات رسائل مطابقة لهذا الفلتر.'
  }
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    const savedLang = localStorage.getItem('appLanguage') as Language;
    if (savedLang && (savedLang === 'en' || savedLang === 'ar')) {
      setLanguageState(savedLang);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('appLanguage', lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  };

  // Set initial dir
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: string) => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
