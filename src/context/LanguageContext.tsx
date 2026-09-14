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
    // Admin
    createUser: 'Create User',
    displayName: 'Display Name',
    department: 'Department',
    role: 'Role',
    addUser: 'Add User',
    userDirectory: 'User Directory',
    actions: 'Actions',
    // Dashboard
    yourSession: 'Your Session',
    manageSession: 'Manage your isolated WhatsApp connection',
    connectionStatus: 'Connection Status',
    startSession: 'Start Session',
    disconnect: 'Disconnect',
    resetSession: 'Reset / Re-scan QR',
    scanQR: 'Scan with WhatsApp to link your isolated session.',
    initializing: 'Initializing...',
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
    // Admin
    createUser: 'إنشاء مستخدم',
    displayName: 'الاسم المعروض',
    department: 'القسم',
    role: 'الصلاحية',
    addUser: 'إضافة مستخدم',
    userDirectory: 'دليل المستخدمين',
    actions: 'إجراءات',
    // Dashboard
    yourSession: 'جلستك',
    manageSession: 'إدارة اتصال واتساب الخاص بك',
    connectionStatus: 'حالة الاتصال',
    startSession: 'بدء الجلسة',
    disconnect: 'قطع الاتصال',
    resetSession: 'إعادة تعيين / مسح الرمز',
    scanQR: 'امسح الرمز باستخدام واتساب لربط جلستك.',
    initializing: 'جاري التهيئة...',
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
