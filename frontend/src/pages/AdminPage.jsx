import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
    addWhitelistEntry,
    getAdminSession,
    getAdminSettings,
    getParkingActivity,
    getAnalytics,
    getWhitelist,
    loginAdmin,
    removeWhitelistEntry,
    saveBillingConfig,
    saveCameraConfig,
    saveGarageSettings,
    removeParkingSession,
    updateParkingVehicle,
    getAdminSecurityStatus,
    sendAdminEmailVerification,
    verifyAdminEmail,
    setupAdminTotp,
    confirmAdminTotp,
    requestPasswordRecovery,
    verifyRecoveryEmail,
    verifyRecoveryTotp,
    resetAdminPassword,
} from "../services/api";

import {
    exportParkingActivityCsv,
    PARKING_ACTIVITY_EXPORT_TABLES,
} from "../services/parkingActivityExport";

import "../styles/AdminPage.css";
import { activatePlateImageFolder, localPlateImageSupport, savedPlateImageFolderName, selectPlateImageFolder } from "../services/localPlateImages";

const TOKEN_KEY = "parking_admin_token";
const LANGUAGE_KEY = "parking_admin_language";
const THEME_KEY = "parking_admin_theme";
const CAMERA_ASSIGNMENTS_KEY = "parking_camera_assignments";
const GARAGE_SETTINGS_UPDATED_KEY = "parking_garage_settings_updated";
const PARKING_DATA_UPDATED_KEY = "parking_data_updated";
const PARKING_DATA_UPDATED_EVENT = "parking-data-updated";
const MAX_GARAGE_LEVELS = 25;
const MAX_TOTAL_PARKING_SPACES = 1000;
const GARAGE_CAPACITY_ERROR_PREFIX = "Maximum parking capacity is";

// Signals an open GaragePage (same tab or another tab/window) to re-fetch
// parking spaces. The storage write reaches other tabs; the custom event
// covers the same tab (native "storage" events never fire there). Only the
// change timestamp is stored -- never parking data itself.
function emitParkingDataUpdated() {
    localStorage.setItem(PARKING_DATA_UPDATED_KEY, String(Date.now()));
    window.dispatchEvent(new CustomEvent(PARKING_DATA_UPDATED_EVENT));
}

function openOrFocusNamedTab(url, name) {
    const target = window.open("", name);
    if (!target) return;

    try {
        if (
            target.location.origin !== window.location.origin ||
            target.location.pathname !== url
        ) {
            target.location.href = url;
        }
    } catch {
        target.location.href = url;
    }

    target.focus();
}

const TRANSLATIONS = {
    en: {
        language: "اردو", theme: "Dark mode", lightTheme: "Light mode", signOut: "Sign out",
        controlCenter: "Control center", whitelist: "Whitelist", garageSettings: "Garage Setup", cameraSetup: "Camera Setup", billing: "Billing",
        vehicleTitle: "Vehicle", whitelistTitle: "whitelist.", vehicleIntro: "Give trusted vehicles a custom discount at checkout.",
        addVehicle: "Add vehicle", numberPlate: "Number plate", name: "Name", discountPercentage: "Discount percentage", addToWhitelist: "Add to whitelist",
        removeVehicle: "Remove vehicle", nameOrPlate: "Name or number plate", searchList: "Search the list", removeHint: "Enter either the assigned name or the exact number plate.", removeFromList: "Remove from list",
        hideList: "Hide list", showList: "Show list", discount: "Discount", added: "Added",
        garageTitle: "Garage", layoutTitle: "layout.", garageIntro: "Set up the structure of your parking garage, then fine-tune each level with custom names and space counts.",
        levels: "Levels", spacesPerLevel: "Spaces per level", advancedEditor: "Advanced floor editor", advancedHint: "Rename each floor and set the exact number of spaces for that level.", levelName: "Level name", spaces: "Spaces", apply: "Apply", advanced: "Advanced",
        confirmLayout: "Confirm garage layout", cancel: "Cancel", confirm: "Confirm",
        cameraTitle: "Entry & exit", cameraSetupTitle: "camera setup.", cameraIntro: "Set the number of cameras for each lane. Each lane must have 1–4 cameras.", entryCameras: "Entry lane cameras", exitCameras: "Exit lane cameras", saveCameras: "Save cameras",
        paymentTitle: "Payment", paymentSettings: "settings.", paymentIntro: "Enable or disable payment options for your parking garage.", enablePayments: "Enable payment options", acceptedPayments: "Select accepted payment methods:", cash: "Cash", card: "Card",
        workspace: "Admin workspace", welcomeBack: "Welcome back,", online: "System online", workspaceIntro: "Select a feature from the sidebar to manage your garage.",
        adminAccess: "Garage administration", makeEvery: "Make every", spaceCount: "space count.", loginIntro: "A clear, quiet view of the operation behind your parking floor.", secureAccess: "Secure admin access", signInTitle: "Sign in to", yourWorkspace: "your workspace.", username: "Username or Email", password: "Password", signingIn: "Signing in...", enterWorkspace: "Enter workspace", showPassword: "Show password", hidePassword: "Hide password", forgotPassword: "Forgot password?", forgotPasswordTitle: "Forgot password", forgotPasswordHint: "Enter your Username or Email", continueLabel: "Continue", backToSignIn: "← Back to sign in", forgotPasswordNotice: "Password recovery isn't available yet. Please contact your administrator.",
        required: "This field is required.", zero: "This field cannot be zero.", positiveNumber: "Please enter a valid positive number.", maxLevels: "Maximum 25 levels allowed.", cameraRange: "Please enter a value between 1 and 4.", fixErrors: "Please fix the errors before applying.", fixCameraErrors: "Please fix the camera lane errors before saving.", vehicleAdded: "Vehicle added to the whitelist.", vehicleRemoved: "Vehicle removed from the whitelist.", garageApplied: "Garage layout applied successfully.", camerasSaved: "Camera allocation saved successfully.", billingApplied: "Billing settings applied successfully.", loginFailed: "Unable to sign in. Please check your credentials.", requestFailed: "Unable to complete that request. Please try again.", checkingSession: "Checking session...", examplePlate: "e.g. ABC-123", exampleManager: "e.g. Manager",
    },
    ur: {
        language: "English", theme: "ڈارک موڈ", lightTheme: "لائٹ موڈ", signOut: "سائن آؤٹ",
        controlCenter: "کنٹرول سینٹر", whitelist: "وائٹ لسٹ", garageSettings: "گیراج سیٹنگز", cameraSetup: "کیمرہ سیٹ اپ", billing: "بلنگ",
        vehicleTitle: "وہیکل", whitelistTitle: "وائٹ لسٹ۔", vehicleIntro: "ٹرسٹڈ وہیکلز کو چیک آؤٹ پر کسٹم ڈسکاؤنٹ دیں۔",
        addVehicle: "وہیکل ایڈ کریں", numberPlate: "نمبر پلیٹ", name: "نام", discountPercentage: "ڈسکاؤنٹ پرسنٹیج", addToWhitelist: "وائٹ لسٹ میں ایڈ کریں",
        removeVehicle: "وہیکل ریموو کریں", nameOrPlate: "نام یا نمبر پلیٹ", searchList: "لسٹ میں سرچ کریں", removeHint: "اسائنڈ نام یا درست نمبر پلیٹ درج کریں۔", removeFromList: "لسٹ سے ریموو کریں",
        hideList: "لسٹ ہائیڈ کریں", showList: "لسٹ شو کریں", discount: "ڈسکاؤنٹ", added: "ایڈ کرنے کی تاریخ",
        garageTitle: "گیراج", layoutTitle: "لے آؤٹ۔", garageIntro: "اپنے پارکنگ گیراج کا سٹرکچر سیٹ اپ کریں، پھر ہر لیول کا نام اور سپیسز کی تعداد سیٹ کریں۔",
        levels: "لیولز", spacesPerLevel: "فی لیول سپیسز", advancedEditor: "ایڈوانسڈ فلور ایڈیٹر", advancedHint: "ہر فلور کا نام بدلیں اور اس لیول کے لیے صحیح سپیسز کی تعداد سیٹ کریں۔", levelName: "لیول کا نام", spaces: "سپیسز", apply: "اپلائی کریں", advanced: "ایڈوانسڈ",
        confirmLayout: "گیراج لے آؤٹ کنفرم کریں", cancel: "کینسل کریں", confirm: "کنفرم کریں",
        cameraTitle: "انٹری اور ایگزٹ", cameraSetupTitle: "کیمرہ سیٹ اپ۔", cameraIntro: "ہر لین کے لیے کیمروں کی تعداد سیٹ کریں۔ ہر لین میں 1 سے 4 کیمرے ہونے چاہئیں۔", entryCameras: "انٹری لین کیمرے", exitCameras: "ایگزٹ لین کیمرے", saveCameras: "کیمرے سیو کریں",
        paymentTitle: "پیمنٹ", paymentSettings: "سیٹنگز۔", paymentIntro: "اپنے پارکنگ گیراج کے لیے پیمنٹ آپشنز اینیبل یا ڈس ایبل کریں۔", enablePayments: "پیمنٹ آپشنز اینیبل کریں", acceptedPayments: "ایکسیپٹڈ پیمنٹ میتھڈز سلیکٹ کریں:", cash: "کیش", card: "کارڈ",
        workspace: "ایڈمن ورک اسپیس", welcomeBack: "ویلکم بیک،", online: "سسٹم آن لائن ہے", workspaceIntro: "اپنا گیراج منیج کرنے کے لیے سائیڈ بار سے ایک فیچر سلیکٹ کریں۔",
        adminAccess: "گیراج ایڈمنسٹریشن", makeEvery: "ہر", spaceCount: "سپیس اہم بنائیں۔", loginIntro: "آپ کے پارکنگ فلور کے آپریشن کا ایک کلیئر، کوائٹ ویو۔", secureAccess: "سیکیور ایڈمن ایکسیس", signInTitle: "اپنی ورک اسپیس میں", yourWorkspace: "سائن ان کریں۔", username: "یوزر نیم یا ای میل", password: "پاس ورڈ", signingIn: "سائن ان ہو رہا ہے...", enterWorkspace: "ورک اسپیس اینٹر کریں", showPassword: "پاس ورڈ شو کریں", hidePassword: "پاس ورڈ ہائیڈ کریں", forgotPassword: "پاس ورڈ بھول گئے؟", forgotPasswordTitle: "پاس ورڈ بھول گئے", forgotPasswordHint: "اپنا یوزر نیم یا ای میل درج کریں", continueLabel: "کنٹینیو کریں", backToSignIn: "← سائن ان پر بیک جائیں", forgotPasswordNotice: "پاس ورڈ ریکوری ابھی دستیاب نہیں۔ براہ کرم اپنے ایڈمنسٹریٹر سے کانٹیکٹ کریں۔",
        required: "یہ فیلڈ ضروری ہے۔", zero: "یہ فیلڈ زیرو نہیں ہو سکتی۔", positiveNumber: "براہ کرم ایک ویلڈ پازیٹو نمبر درج کریں۔", maxLevels: "زیادہ سے زیادہ 25 لیولز الاؤڈ ہیں۔", cameraRange: "براہ کرم 1 سے 4 کے درمیان ویلیو درج کریں۔", fixErrors: "اپلائی کرنے سے پہلے ایررز فکس کریں۔", fixCameraErrors: "سیو کرنے سے پہلے کیمرہ لین ایررز فکس کریں۔", vehicleAdded: "وہیکل وائٹ لسٹ میں ایڈ ہو گئی ہے۔", vehicleRemoved: "وہیکل وائٹ لسٹ سے ریموو ہو گئی ہے۔", garageApplied: "گیراج لے آؤٹ کامیابی سے اپلائی ہو گیا ہے۔", camerasSaved: "کیمرہ الوکیشن کامیابی سے سیو ہو گئی ہے۔", billingApplied: "بلنگ سیٹنگز کامیابی سے اپلائی ہو گئی ہیں۔", loginFailed: "سائن ان نہیں ہو سکا۔ براہ کرم اپنی کریڈینشلز چیک کریں۔", requestFailed: "وہ ریکویسٹ کمپلیٹ نہیں ہو سکی۔ براہ کرم دوبارہ ٹرائی کریں۔", checkingSession: "سیشن چیک ہو رہا ہے...", examplePlate: "مثلاً ABC-123", exampleManager: "مثلاً منیجر",
    },
};

const ANALYTICS_METRICS = [
    { key: "earnings", label: "Earnings" },
    { key: "rush", label: "Rush Hour" },
    { key: "duration", label: "Average Duration" },
    { key: "traffic", label: "Vehicles / Traffic" },
];

const ANALYTICS_METRIC_TITLES = {
    earnings: "Earnings trend (Rs)",
    rush: "Hourly vehicle activity (vehicles)",
    duration: "Average parking duration (minutes)",
    traffic: "Vehicle traffic (vehicles)",
};

function getAnalyticsBarPoints(analytics, metric) {
    const rows = metric === "rush" ? analytics.hourly_activity : analytics.trend;
    return rows.map((point, index) => ({
        key: point.date || `hour-${point.hour ?? index}`,
        label: point.date ? point.date.slice(5) : `${point.hour}:00`,
        value:
            metric === "earnings"
                ? point.earnings
                : metric === "traffic" || metric === "rush"
                    ? point.vehicles
                    : (point.average_duration_seconds || 0) / 60,
    }));
}

function formatAnalyticsDuration(minutes) {
    const total = Math.round(minutes);
    if (total < 60) return `${total} min`;
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function formatRushHourRange(rushHour) {
    if (!rushHour) return "No data";
    const startHour = Number(rushHour.slice(0, 2));
    const endHour = (startHour + 1) % 24;
    const formatHour = (hour) => `${(hour % 12) || 12} ${hour >= 12 ? "PM" : "AM"}`;
    return `${formatHour(startHour)} – ${formatHour(endHour)}`;
}

function EyeIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function EyeOffIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A10.4 10.4 0 0 1 12 5c7 0 11 7 11 7a20.6 20.6 0 0 1-3.35 4.3" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    );
}

function EditIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    );
}

function StarIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2.5l2.9 6.1 6.6.7-4.9 4.6 1.3 6.6L12 17.6l-5.9 3.1 1.3-6.6-4.9-4.6 6.6-.7Z" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
    );
}

function DisplayControls({ theme, language, onLanguageChange, onThemeChange }) {
    return (
        <div className="admin-display-controls">
            <select className="language-select" value={language} onChange={(event) => onLanguageChange(event.target.value)} aria-label="Select language">
                <option value="en">English</option>
                <option value="ur">اردو</option>
            </select>
            <select className="language-select" value={theme} onChange={(event) => onThemeChange(event.target.value)} aria-label="Select theme">
                <option value="system">System Default</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
            </select>
        </div>
    );
}

function AdminPage() {
    useEffect(() => {
        window.name = "parkingos-admin";
    }, []);

    const [language, setLanguage] = useState(() => localStorage.getItem(LANGUAGE_KEY) === "ur" ? "ur" : "en");
    const [theme, setTheme] = useState(() => ["system", "light", "dark"].includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : "light");
    const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false);
    const appliedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
    const t = TRANSLATIONS[language];
    const isUrdu = language === "ur";
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
    const [forgotNotice, setForgotNotice] = useState("");

    // Forgot-password state machine: forgot_identifier -> forgot_email_code
    // -> forgot_totp -> forgot_new_password -> forgot_success.
    const [forgotStep, setForgotStep] = useState("forgot_identifier");
    const [forgotError, setForgotError] = useState("");
    const [forgotSubmitting, setForgotSubmitting] = useState(false);
    const [recoveryChallengeToken, setRecoveryChallengeToken] = useState("");
    const [recoveryEmailCode, setRecoveryEmailCode] = useState("");
    const [recoveryTotpCode, setRecoveryTotpCode] = useState("");
    const [recoveryResetToken, setRecoveryResetToken] = useState("");
    const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
    const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
    const [recoveryShowNewPassword, setRecoveryShowNewPassword] = useState(false);
    const [recoveryShowConfirmPassword, setRecoveryShowConfirmPassword] = useState(false);

    // Account Security modal (logged-in admin: email verification + TOTP).
    const [securityModalOpen, setSecurityModalOpen] = useState(false);
    const [securityStatus, setSecurityStatus] = useState(null);
    const [securityLoading, setSecurityLoading] = useState(false);
    const [securityError, setSecurityError] = useState("");
    const [securityMessage, setSecurityMessage] = useState("");
    const [securityEmailCodeSent, setSecurityEmailCodeSent] = useState(false);
    const [securityEmailCode, setSecurityEmailCode] = useState("");
    const [securityTotpSetup, setSecurityTotpSetup] = useState(null);
    const [securityTotpCode, setSecurityTotpCode] = useState("");
    const [adminName, setAdminName] = useState("");
    const [token, setToken] = useState(() => {
        return localStorage.getItem(TOKEN_KEY);
    });
    const [loading, setLoading] = useState(Boolean(token));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [activeFeature, setActiveFeature] = useState(null);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const [plate, setPlate] = useState("");
    const [vehicleName, setVehicleName] = useState("");
    const [discount, setDiscount] = useState("");
    const [removeSearch, setRemoveSearch] = useState("");
    const [whitelist, setWhitelist] = useState([]);
    const [whitelistVisible, setWhitelistVisible] = useState(false);
    const [whitelistLoading, setWhitelistLoading] = useState(false);
    const [whitelistLoaded, setWhitelistLoaded] = useState(false);
    const [whitelistListLoading, setWhitelistListLoading] = useState(false);
    const whitelistFetchInFlightRef = useRef(false);
    const [whitelistError, setWhitelistError] = useState("");
    const [whitelistMessage, setWhitelistMessage] = useState("");
    const [garageSettings, setGarageSettings] = useState({ mode: "parking", level_count: "", levels: [], spaces_per_level: "" });
    const [localImageFolder, setLocalImageFolder] = useState("");
    const [pendingLocalImageFolder, setPendingLocalImageFolder] = useState(null);
    const [localImageStatus, setLocalImageStatus] = useState("");
    const [garageSettingsMessage, setGarageSettingsMessage] = useState("");
    const [garageSettingsAlreadyApplied, setGarageSettingsAlreadyApplied] = useState(false);
    const [savedGarageSettings, setSavedGarageSettings] = useState(null);
    const [garageSettingsMessageType, setGarageSettingsMessageType] = useState("success");
    const [garageErrors, setGarageErrors] = useState({
        levels: "",
        spaces_per_level: "",
    });
    const [levelErrors, setLevelErrors] = useState({});
    const [cameraConfig, setCameraConfig] = useState({ entry_lane_cameras: "", exit_lane_cameras: "" });
    const [cameraErrors, setCameraErrors] = useState({
        entry_lane_cameras: "",
        exit_lane_cameras: "",
    });
    const [cameraMessage, setCameraMessage] = useState("");
    const [cameraMessageType, setCameraMessageType] = useState("success");
    const [savedCameraSetup, setSavedCameraSetup] = useState(null);
    const [cameraDevices, setCameraDevices] = useState([]);
    const [cameraDevicesLoading, setCameraDevicesLoading] = useState(false);
    const [cameraAssignments, setCameraAssignments] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(CAMERA_ASSIGNMENTS_KEY)) || {};
        } catch {
            return {};
        }
    });
    const [advancedGarageSettings, setAdvancedGarageSettings] = useState(false);
    const [confirmationOpen, setConfirmationOpen] = useState(false);
    const [confirmationSection, setConfirmationSection] = useState(null);
    const [settingsSubmitting, setSettingsSubmitting] = useState(null);
    const [billingConfig, setBillingConfig] = useState({ payments_enabled: false, cash_enabled: false, card_enabled: false, rate_per_minute: 1.67, rate_unit: "minute" });
    const [billingMessage, setBillingMessage] = useState("");
    const [billingMessageType, setBillingMessageType] = useState("success");
    const [billingRateError, setBillingRateError] = useState("");
    const [savedBillingConfig, setSavedBillingConfig] = useState(null);
    const [parkingActivity, setParkingActivity] = useState(null);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityError, setActivityError] = useState("");
    const [activityExportRange, setActivityExportRange] = useState("24h");
    const [activityExportCustomStart, setActivityExportCustomStart] = useState("");
    const [activityExportCustomEnd, setActivityExportCustomEnd] = useState("");
    const [activityExportTables, setActivityExportTables] = useState({
        live_sessions: true,
        space_status: false,
        vehicles: false,
        history: true,
    });
    const [activityExportError, setActivityExportError] = useState("");
    const [activityExportOpen, setActivityExportOpen] = useState(false);
    const [analytics, setAnalytics] = useState(null);
    const [analyticsMetric, setAnalyticsMetric] = useState("earnings");
    const [analyticsPeriod, setAnalyticsPeriod] = useState("7d");
    const [activeSessionMenuId, setActiveSessionMenuId] = useState(null);
    const [sessionMenuPosition, setSessionMenuPosition] = useState(null);
    const activityLoadingRef = useRef(false);

    useEffect(() => {
        localStorage.setItem(LANGUAGE_KEY, language);
    }, [language]);

    useEffect(() => {
        localStorage.setItem(
            CAMERA_ASSIGNMENTS_KEY,
            JSON.stringify(cameraAssignments)
        );
    }, [cameraAssignments]);

    useEffect(() => {
        localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    // Session menu dropdowns render through a portal attached directly to
    // <body>, outside the themed .admin-shell wrapper, so .admin-theme-dark
    // descendant selectors can't reach them unless a shared ancestor above
    // body carries the class too. Mirroring the theme onto <html> also fixes
    // the overscroll/rubber-band canvas color: index.css hardcodes a light
    // `html { background }` that the browser paints behind the document
    // (used for that bounce region), so once Parking Activity's tables push
    // the page taller than the viewport, scrolling past the edge flashed that
    // unrelated light gray instead of the current admin theme.
    useEffect(() => {
        const isDark = appliedTheme === "dark";
        document.documentElement.classList.toggle("admin-theme-dark", isDark);
        // Dark background comes from the existing .admin-theme-dark rule
        // (a class selector beats index.css's plain `html` element selector);
        // light mode has no such generic class, so match .admin-shell's
        // background directly here.
        document.documentElement.style.background = isDark ? "" : "#e8efe6";
        return () => {
            document.documentElement.classList.remove("admin-theme-dark");
            document.documentElement.style.background = "";
        };
    }, [appliedTheme]);

    useEffect(() => {
        const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
        if (!mediaQuery) return;
        const updateSystemTheme = (event) => setSystemDark(event.matches);
        setSystemDark(mediaQuery.matches);
        mediaQuery.addEventListener?.("change", updateSystemTheme);
        return () => mediaQuery.removeEventListener?.("change", updateSystemTheme);
    }, []);

    useEffect(() => {
        if (!token) return;
        getAdminSession(token)
            .then((session) => setAdminName(session.username))
            .catch((sessionError) => {
                if (sessionError.status === 401) {
                    localStorage.removeItem(TOKEN_KEY);
                    sessionStorage.removeItem(TOKEN_KEY);
                    setToken(null);
                }
            })
            .finally(() => setLoading(false));

        getAdminSettings(token)
            .then((settings) => {
                const garage = settings.garage_settings;
                if (garage) {
                    const normalizedGarageSettings = {
                        mode: garage.mode || "parking", level_count: String(garage.level_count),
                        local_image_saving: Boolean(garage.local_image_saving),
                        spaces_per_level: String(garage.spaces_per_level),
                        automatic_entry: Boolean(garage.automatic_entry),
                        levels: (garage.levels || []).map((level) => ({
                            ...level,
                            spaces: String(level.spaces),
                        })),
                    };

                    setGarageSettings(normalizedGarageSettings);
                    setSavedGarageSettings(normalizedGarageSettings);
                }
                if (settings.camera_config) {
                    const normalizedCameraConfig = {
                        entry_lane_cameras: String(safeCameraCount(settings.camera_config.entry_lane_cameras)),
                        exit_lane_cameras: String(safeCameraCount(settings.camera_config.exit_lane_cameras)),
                    };
                    setCameraConfig(normalizedCameraConfig);
                    setSavedCameraSetup(normalizeCameraSetup(normalizedCameraConfig, cameraAssignments));
                }
                if (settings.billing_config) {
                    const normalizedBillingConfig = {
                        ...settings.billing_config,
                        rate_per_minute: settings.billing_config.rate_per_minute ?? 1.67, rate_unit: settings.billing_config.rate_unit || "minute",
                    };
                    setBillingConfig(normalizedBillingConfig);
                    setSavedBillingConfig(normalizeBillingConfig(normalizedBillingConfig));
                }
            })
            .catch(() => { });
    }, [token]);
    useEffect(() => { savedPlateImageFolderName().then((name) => setLocalImageFolder(name || "")).catch(() => { }); }, []);
    useEffect(() => {
        setGarageSettingsAlreadyApplied(
            isGarageSettingsAlreadyApplied(
                garageSettings,
                savedGarageSettings
            ) && !pendingLocalImageFolder
        );
    }, [garageSettings, savedGarageSettings, pendingLocalImageFolder]);
    // Live capacity feedback as levels/spaces are edited, ahead of the
    // hard checks at apply/save time. Only touches the message when it
    // owns it (the capacity text), so it never clobbers an unrelated
    // success/warning message set elsewhere.
    useEffect(() => {
        if ((garageSettings.mode || "parking") !== "parking") return;
        const capacityError = buildGarageCapacityError(computeGarageTotalSpaces(garageSettings.levels));
        if (capacityError) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage(capacityError);
        } else {
            setGarageSettingsMessage((current) => (current.startsWith(GARAGE_CAPACITY_ERROR_PREFIX) ? "" : current));
        }
    }, [garageSettings.levels, garageSettings.mode, advancedGarageSettings]);

    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError("");
        try {
            const result = await loginAdmin(identifier, password);
            localStorage.setItem(TOKEN_KEY, result.access_token);
            sessionStorage.removeItem(TOKEN_KEY);
            setToken(result.access_token);
            setAdminName(identifier.trim());
            setPassword("");
        } catch {
            setError(t.loginFailed);
        } finally {
            setSubmitting(false);
        }
    }

    function resetForgotPasswordState() {
        setForgotStep("forgot_identifier");
        setForgotNotice("");
        setForgotError("");
        setForgotSubmitting(false);
        setRecoveryChallengeToken("");
        setRecoveryEmailCode("");
        setRecoveryTotpCode("");
        setRecoveryResetToken("");
        setRecoveryNewPassword("");
        setRecoveryConfirmPassword("");
        setRecoveryShowNewPassword(false);
        setRecoveryShowConfirmPassword(false);
    }

    function openForgotPassword() {
        resetForgotPasswordState();
        setForgotPasswordOpen(true);
    }

    function closeForgotPassword() {
        resetForgotPasswordState();
        setForgotPasswordOpen(false);
    }

    async function handleRecoveryIdentifierSubmit(event) {
        event.preventDefault();
        setForgotSubmitting(true);
        setForgotError("");
        try {
            const result = await requestPasswordRecovery(identifier);
            setRecoveryChallengeToken(result.challenge_token || "");
            setForgotNotice(result.message || "If the account is eligible for recovery, a verification code has been sent.");
            setForgotStep("forgot_email_code");
        } catch (error) {
            setForgotError(error.message || t.requestFailed);
        } finally {
            setForgotSubmitting(false);
        }
    }

    async function handleRecoveryEmailCodeSubmit(event) {
        event.preventDefault();
        setForgotSubmitting(true);
        setForgotError("");
        try {
            await verifyRecoveryEmail(recoveryChallengeToken, recoveryEmailCode.trim());
            setForgotNotice("");
            setRecoveryEmailCode("");
            setForgotStep("forgot_totp");
        } catch (error) {
            setForgotError(error.message || "Invalid or expired verification code.");
        } finally {
            setForgotSubmitting(false);
        }
    }

    async function handleRecoveryTotpSubmit(event) {
        event.preventDefault();
        setForgotSubmitting(true);
        setForgotError("");
        try {
            const result = await verifyRecoveryTotp(recoveryChallengeToken, recoveryTotpCode.trim());
            setRecoveryResetToken(result.reset_token || "");
            setRecoveryTotpCode("");
            setForgotStep("forgot_new_password");
        } catch (error) {
            setForgotError(error.message || "Invalid or expired verification code.");
        } finally {
            setForgotSubmitting(false);
        }
    }

    async function handleRecoveryResetSubmit(event) {
        event.preventDefault();
        setForgotError("");

        if (recoveryNewPassword.length < 12) {
            setForgotError("Password must be at least 12 characters.");
            return;
        }
        if (recoveryNewPassword !== recoveryConfirmPassword) {
            setForgotError("Passwords do not match.");
            return;
        }

        setForgotSubmitting(true);
        try {
            await resetAdminPassword(recoveryResetToken, recoveryNewPassword);
            // Clear every recovery secret from memory now that it's been used.
            setRecoveryChallengeToken("");
            setRecoveryEmailCode("");
            setRecoveryTotpCode("");
            setRecoveryResetToken("");
            setRecoveryNewPassword("");
            setRecoveryConfirmPassword("");
            setForgotStep("forgot_success");
        } catch (error) {
            setForgotError(error.message || "Unable to reset password.");
        } finally {
            setForgotSubmitting(false);
        }
    }

    function signOut() {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setAdminName("");
        setSecurityModalOpen(false);
        setSecurityStatus(null);
        setSecurityEmailCodeSent(false);
        setSecurityEmailCode("");
        setSecurityTotpSetup(null);
        setSecurityTotpCode("");
        setSecurityError("");
        setSecurityMessage("");
    }

    async function loadSecurityStatus() {
        if (!token) return;
        setSecurityLoading(true);
        setSecurityError("");
        try {
            const result = await getAdminSecurityStatus(token);
            setSecurityStatus(result);
        } catch (error) {
            setSecurityError(error.message || t.requestFailed);
        } finally {
            setSecurityLoading(false);
        }
    }

    function openSecurityModal() {
        setAccountMenuOpen(false);
        setSecurityError("");
        setSecurityMessage("");
        setSecurityEmailCodeSent(false);
        setSecurityEmailCode("");
        setSecurityTotpSetup(null);
        setSecurityTotpCode("");
        setSecurityModalOpen(true);
        void loadSecurityStatus();
    }

    function closeSecurityModal() {
        setSecurityModalOpen(false);
    }

    async function handleSendEmailVerification() {
        setSecurityLoading(true);
        setSecurityError("");
        setSecurityMessage("");
        try {
            const result = await sendAdminEmailVerification(token);
            setSecurityMessage(result.message || "A verification code was sent to your email.");
            setSecurityEmailCodeSent(true);
        } catch (error) {
            setSecurityError(error.message || t.requestFailed);
        } finally {
            setSecurityLoading(false);
        }
    }

    async function handleVerifyEmailCode(event) {
        event.preventDefault();
        setSecurityLoading(true);
        setSecurityError("");
        try {
            await verifyAdminEmail(token, securityEmailCode.trim());
            setSecurityEmailCode("");
            setSecurityEmailCodeSent(false);
            setSecurityMessage("Email verified.");
            await loadSecurityStatus();
        } catch (error) {
            setSecurityError(error.message || "Invalid or expired verification code.");
        } finally {
            setSecurityLoading(false);
        }
    }

    async function handleSetupTotp() {
        setSecurityLoading(true);
        setSecurityError("");
        setSecurityMessage("");
        try {
            const result = await setupAdminTotp(token);
            setSecurityTotpSetup(result);
        } catch (error) {
            setSecurityError(error.message || t.requestFailed);
        } finally {
            setSecurityLoading(false);
        }
    }

    async function handleConfirmTotp(event) {
        event.preventDefault();
        setSecurityLoading(true);
        setSecurityError("");
        try {
            await confirmAdminTotp(token, securityTotpCode.trim());
            setSecurityTotpCode("");
            setSecurityTotpSetup(null);
            setSecurityMessage("Authenticator enabled.");
            await loadSecurityStatus();
        } catch (error) {
            setSecurityError(error.message || "Invalid or expired verification code.");
        } finally {
            setSecurityLoading(false);
        }
    }

    async function loadParkingActivity() {
        if (activityLoadingRef.current) return;
        activityLoadingRef.current = true;
        setActivityLoading(true);
        setActivityError("");
        try {
            setParkingActivity(await getParkingActivity(token));
        } catch (err) {
            setActivityError(err.message || "Unable to load parking activity.");
        } finally {
            activityLoadingRef.current = false;
            setActivityLoading(false);
        }
    }

    function toggleActivityExportTable(tableId) {
        setActivityExportTables((current) => ({
            ...current,
            [tableId]: !current[tableId],
        }));

        setActivityExportError("");
    }

    async function handleParkingActivityExport() {
        setActivityExportError("");

        try {
            const tables = PARKING_ACTIVITY_EXPORT_TABLES
                .filter((table) => activityExportTables[table.id])
                .map((table) => table.id);

            await exportParkingActivityCsv(parkingActivity, {
                rangePreset: activityExportRange,
                customStart: activityExportCustomStart,
                customEnd: activityExportCustomEnd,
                tables,
            });
        } catch (error) {
            setActivityExportError(
                error?.message || "Unable to export parking activity."
            );
        }
    }

    useEffect(() => {
        if (activeFeature !== "parking-activity" || !token) return undefined;
        const interval = window.setInterval(() => {
            void loadParkingActivity();
        }, 10000);
        return () => window.clearInterval(interval);
    }, [activeFeature, token]);

    useEffect(() => {
        const closeMenus = (event) => {
            if (!event.target.closest(".account-menu")) setAccountMenuOpen(false);
            if (!event.target.closest(".vehicle-menu, .vehicle-menu-dropdown")) {
                setActiveSessionMenuId(null);
                setSessionMenuPosition(null);
            }
        };
        const closeOnEscape = (event) => { if (event.key === "Escape") { setAccountMenuOpen(false); setActiveSessionMenuId(null); setSessionMenuPosition(null); } };
        document.addEventListener("mousedown", closeMenus);
        document.addEventListener("keydown", closeOnEscape);
        return () => { document.removeEventListener("mousedown", closeMenus); document.removeEventListener("keydown", closeOnEscape); };
    }, []);

    async function submitWhitelist(event) {
        event.preventDefault();
        setWhitelistLoading(true);
        setWhitelistError("");
        setWhitelistMessage("");
        try {
            const newEntry = await addWhitelistEntry(token, {
                license_plate: plate,
                vehicle_name: vehicleName,
                discount_percent: Number(discount),
            });
            const nextEntry = newEntry?.entry || {
                id: Date.now(),
                license_plate: plate.trim().toUpperCase(),
                vehicle_name: vehicleName.trim(),
                discount_percent: Number(discount),
                created_at: new Date().toISOString(),
            };
            setWhitelist((currentEntries) => {
                const exists = currentEntries.some(
                    (entry) => entry.license_plate.toLowerCase() === nextEntry.license_plate.toLowerCase()
                );
                return exists ? currentEntries : [nextEntry, ...currentEntries];
            });
            setWhitelistVisible(true);
            if (!whitelistLoaded) void loadWhitelist();
            setPlate("");
            setVehicleName("");
            setDiscount("");
            setWhitelistMessage(t.vehicleAdded);
        } catch {
            setWhitelistError(t.requestFailed);
        } finally {
            setWhitelistLoading(false);
        }
    }

    async function submitRemove(event) {
        event.preventDefault();
        setWhitelistLoading(true);
        setWhitelistError("");
        setWhitelistMessage("");
        try {
            await removeWhitelistEntry(token, removeSearch);
            const normalizedSearch = removeSearch.trim();
            setWhitelist((currentEntries) =>
                currentEntries.filter((entry) => {
                    const matchesPlate = entry.license_plate.toLowerCase() === normalizedSearch.toLowerCase();
                    const matchesName = entry.vehicle_name.toLowerCase() === normalizedSearch.toLowerCase();
                    return !(matchesPlate || matchesName);
                })
            );
            setRemoveSearch("");
            setWhitelistVisible(true);
            if (!whitelistLoaded) void loadWhitelist();
            setWhitelistMessage(t.vehicleRemoved);
        } catch {
            setWhitelistError(t.requestFailed);
        } finally {
            setWhitelistLoading(false);
        }
    }

    async function loadWhitelist() {
        if (whitelistLoaded || whitelistFetchInFlightRef.current) return;

        whitelistFetchInFlightRef.current = true;
        setWhitelistListLoading(true);
        setWhitelistError("");
        try {
            const result = await getWhitelist(token);
            setWhitelist(result.entries || []);
            setWhitelistLoaded(true);
        } catch {
            setWhitelistError(t.requestFailed);
        } finally {
            whitelistFetchInFlightRef.current = false;
            setWhitelistListLoading(false);
        }
    }

    async function chooseLocalImageFolder() {
        try { const folder = await selectPlateImageFolder(); if (folder.name === localImageFolder) { setPendingLocalImageFolder(null); setLocalImageStatus("Selected folder is already active."); return; } setPendingLocalImageFolder(folder); setLocalImageStatus(`New folder selected: ${folder.name}. Apply settings to activate it.`); }
        catch (error) { setLocalImageStatus(error?.message || "Folder selection was cancelled."); }
    }

    async function removeLiveSession(sessionId) {
        if (!window.confirm("Remove this vehicle from parking and free its space?")) return;
        try { await removeParkingSession(token, sessionId); emitParkingDataUpdated(); await loadParkingActivity(); }
        catch (err) { setActivityError(err.message || "Unable to remove parking."); }
    }

    async function editLiveSession(session) {
        const nextPlate = window.prompt("Number plate", session.plate);
        if (!nextPlate || nextPlate.trim().toUpperCase() === session.plate) return;
        try { await updateParkingVehicle(token, session.session_id, nextPlate.trim().toUpperCase()); emitParkingDataUpdated(); await loadParkingActivity(); }
        catch (err) { setActivityError(err.message || "Unable to update vehicle."); }
    }

    function toggleSessionMenu(sessionId, trigger) {
        if (activeSessionMenuId === sessionId) {
            setActiveSessionMenuId(null);
            setSessionMenuPosition(null);
            return;
        }

        const rect = trigger.getBoundingClientRect();
        const menuWidth = 174;
        const menuHeight = 120;
        const gap = 6;
        const top = rect.bottom + gap + menuHeight <= window.innerHeight
            ? rect.bottom + gap
            : Math.max(8, rect.top - menuHeight - gap);
        const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
        setSessionMenuPosition({ top, left });
        setActiveSessionMenuId(sessionId);
    }

    function renderSessionMenu(session) {
        if (activeSessionMenuId !== session.session_id || !sessionMenuPosition) return null;
        return createPortal(
            <div className="vehicle-menu-dropdown vehicle-menu-popover" style={sessionMenuPosition} role="menu">
                <button type="button" role="menuitem" className="vehicle-menu-item" onClick={() => { setActiveSessionMenuId(null); setSessionMenuPosition(null); void editLiveSession(session); }}>
                    <EditIcon /> Edit Info
                </button>
                <button type="button" role="menuitem" className="vehicle-menu-item" onClick={() => { setActiveSessionMenuId(null); setSessionMenuPosition(null); setPlate(session.plate); setActiveFeature("whitelist"); }}>
                    <StarIcon /> Add to Whitelist
                </button>
                <div className="vehicle-menu-divider" role="separator" />
                <button type="button" role="menuitem" className="vehicle-menu-item vehicle-menu-item-danger" onClick={() => { setActiveSessionMenuId(null); setSessionMenuPosition(null); void removeLiveSession(session.session_id); }}>
                    <TrashIcon /> Remove Parking
                </button>
            </div>,
            document.body
        );
    }

    async function loadAnalytics(period = analyticsPeriod) {
        try { setAnalytics(await getAnalytics(token, period)); }
        catch (err) { setActivityError(err.message || "Unable to load analytics."); }
    }

    function renderAnalyticsBars() {
        const points = getAnalyticsBarPoints(analytics, analyticsMetric);
        const max = Math.max(...points.map((point) => point.value), 0);
        return points.map((point) => {
            const height = max > 0 ? Math.max(4, (point.value / max) * 100) : 0;
            const displayValue =
                analyticsMetric === "earnings"
                    ? `Rs ${Number(point.value).toLocaleString("en-PK", { minimumFractionDigits: 2 })}`
                    : analyticsMetric === "duration"
                        ? `${Math.round(point.value)} min`
                        : `${point.value} vehicles`;
            return (
                <div key={point.key} title={displayValue}>
                    <i style={{ height: `${height}%` }} />
                    <small>{point.label}</small>
                </div>
            );
        });
    }

    function showWhitelist() {
        if (whitelistVisible) {
            setWhitelistVisible(false);
            return;
        }

        setWhitelistVisible(true);
        if (!whitelistLoaded) void loadWhitelist();
    }

    function validateCameraField(field, value) {
        if (value === "") {
            return t.required;
        }

        const numericValue = Number(value);
        if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 4) {
            return t.cameraRange;
        }

        return "";
    }

    function safeCameraCount(value) {
        const count = Number(value);
        return Number.isInteger(count) && count >= 1 && count <= 4 ? count : 1;
    }

    function clearUnusedCameraAssignments(config) {
        const entryCount = Number(config.entry_lane_cameras);
        const exitCount = Number(config.exit_lane_cameras);

        if (
            !Number.isInteger(entryCount) ||
            !Number.isInteger(exitCount) ||
            entryCount < 1 ||
            exitCount < 1 ||
            entryCount > 4 ||
            exitCount > 4 ||
            entryCount + exitCount > 4
        ) {
            return;
        }

        setCameraAssignments((current) => {
            const next = { ...current };

            for (let index = 1; index <= 4; index += 1) {
                if (index > entryCount) {
                    delete next[`entry-${index}`];
                }

                if (index > exitCount) {
                    delete next[`exit-${index}`];
                }
            }

            return next;
        });
    }

    function handleCameraConfigChange(field, value) {
        const nextValue = value.replace(/[^\d]/g, "");
        if (value !== nextValue || (nextValue !== "" && (!/^\d$/.test(nextValue) || Number(nextValue) < 1 || Number(nextValue) > 4))) {
            setCameraErrors((current) => ({ ...current, [field]: "Each lane can use between 1 and 4 cameras." }));
            setCameraMessageType("warning");
            setCameraMessage("Each lane can use between 1 and 4 cameras.");
            return;
        }

        const nextConfig = { ...cameraConfig, [field]: nextValue };

        setCameraConfig((current) => ({
            ...current,
            [field]: nextValue,
        }));

        const errorMessage = validateCameraField(field, nextValue);
        setCameraErrors((current) => ({
            ...current,
            [field]: nextValue === "" ? t.required : errorMessage,
        }));

        const total = Number(nextConfig.entry_lane_cameras) + Number(nextConfig.exit_lane_cameras);
        const combinedError = errorMessage === "" && total > 4;

        if (!combinedError) {
            clearUnusedCameraAssignments(nextConfig);
        }

        setCameraMessage(combinedError ? "Camera limit exceeded. A maximum of 4 cameras can be assigned across entry and exit lanes." : "");
        setCameraMessageType(combinedError ? "warning" : "success");
    }

    async function handleCameraConfigSubmit(event) {
        event.preventDefault();
        if (settingsSubmitting === "camera") return;
        const nextErrors = {
            entry_lane_cameras: validateCameraField("entry_lane_cameras", cameraConfig.entry_lane_cameras),
            exit_lane_cameras: validateCameraField("exit_lane_cameras", cameraConfig.exit_lane_cameras),
        };

        setCameraErrors(nextErrors);

        const hasError = Object.values(nextErrors).some((message) => Boolean(message));
        if (hasError || Number(cameraConfig.entry_lane_cameras) + Number(cameraConfig.exit_lane_cameras) > 4) {
            setCameraMessageType("warning");
            setCameraMessage(Number(cameraConfig.entry_lane_cameras) + Number(cameraConfig.exit_lane_cameras) > 4 ? "Camera limit exceeded. A maximum of 4 cameras can be assigned across entry and exit lanes." : t.fixCameraErrors);
            return;
        }

        const activeCameraIds = cameraSlots.map((slot) => slot.id);
        const assignedDeviceIds = activeCameraIds
            .map((cameraId) => cameraAssignments[cameraId])
            .filter(Boolean);

        const hasDuplicateCamera =
            new Set(assignedDeviceIds).size !== assignedDeviceIds.length;

        if (hasDuplicateCamera) {
            setCameraMessageType("warning");
            setCameraMessage(
                "The same physical camera cannot be assigned to more than one camera slot."
            );
            return;
        }

        if (isCameraSetupAlreadyApplied(cameraConfig, cameraAssignments, savedCameraSetup)) {
            setCameraMessageType("warning");
            setCameraMessage("These camera settings are already applied.");
            return;
        }

        openSettingsConfirmation("camera");
    }

    async function refreshCameraDevices() {
        if (cameraDevicesLoading) return;
        setCameraDevicesLoading(true);
        try {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                stream.getTracks().forEach((track) => track.stop());
            } catch {
                // Device labels may remain unavailable until the browser grants access.
            }

            const devices = await navigator.mediaDevices.enumerateDevices();
            setCameraDevices(
                devices.filter((device) => device.kind === "videoinput")
            );
        } finally {
            setCameraDevicesLoading(false);
        }
    }

    function setCameraAssignment(cameraId, deviceId) {
        if (deviceId) {
            const activeCameraIds = cameraSlots.map((slot) => slot.id);

            const alreadyUsedBy = Object.entries(cameraAssignments).find(
                ([otherCameraId, assignedDeviceId]) =>
                    activeCameraIds.includes(otherCameraId) &&
                    otherCameraId !== cameraId &&
                    assignedDeviceId === deviceId
            );

            if (alreadyUsedBy) {
                setCameraMessageType("warning");
                setCameraMessage(
                    "This camera is already assigned to another camera slot. One physical camera can only be used in one field."
                );
                return;
            }
        }

        setCameraAssignments((current) => ({
            ...current,
            [cameraId]: deviceId,
        }));

        setCameraMessage("");
        setCameraMessageType("success");
    }

    const safeEntryCameraCount = safeCameraCount(cameraConfig.entry_lane_cameras);
    const safeExitCameraCount = Math.min(
        safeCameraCount(cameraConfig.exit_lane_cameras),
        Math.max(0, 4 - safeEntryCameraCount)
    );
    const cameraSlots = [
        ...Array.from(
            { length: safeEntryCameraCount },
            (_, index) => ({ id: `entry-${index + 1}`, label: `Entry Camera ${index + 1}` })
        ),
        ...Array.from(
            { length: safeExitCameraCount },
            (_, index) => ({ id: `exit-${index + 1}`, label: `Exit Camera ${index + 1}` })
        ),
    ];
    const cameraSetupAlreadyApplied = isCameraSetupAlreadyApplied(
        cameraConfig,
        cameraAssignments,
        savedCameraSetup
    );
    const billingAlreadyApplied = isBillingConfigAlreadyApplied(
        billingConfig,
        savedBillingConfig
    );

    function handleBillingToggle(field) {
        setBillingConfig((current) => {
            const nextConfig = { ...current, [field]: !current[field] };
            if (!nextConfig.payments_enabled) {
                nextConfig.cash_enabled = false;
                nextConfig.card_enabled = false;
            }
            return nextConfig;
        });
    }

    function validateBillingRate(value) {
        if (String(value).trim() === "") return t.required;
        const rate = Number(value);
        return Number.isFinite(rate) && rate > 0 ? "" : t.positiveNumber;
    }

    function handleBillingRateChange(value) {
        setBillingConfig((current) => ({ ...current, rate_per_minute: value }));
        setBillingRateError(validateBillingRate(value));
    }

    async function handleBillingApply(event) {
        event.preventDefault();
        if (settingsSubmitting === "billing") return;
        if (billingConfig.payments_enabled) {
            const rateError = validateBillingRate(billingConfig.rate_per_minute);
            setBillingRateError(rateError);
            if (rateError) return;
        } else {
            setBillingRateError("");
        }
        if (isBillingConfigAlreadyApplied(billingConfig, savedBillingConfig)) {
            setBillingMessageType("success");
            setBillingMessage("These billing settings are already applied.");
            return;
        }
        openSettingsConfirmation("billing");
    }

    function normalizeCameraSetup(config, assignments) {
        return JSON.stringify({
            entry_lane_cameras: Number(config?.entry_lane_cameras) || 0,
            exit_lane_cameras: Number(config?.exit_lane_cameras) || 0,
            assignments: Object.entries(assignments || {}).sort(([first], [second]) => first.localeCompare(second)),
        });
    }

    function normalizeBillingConfig(config) {
        return JSON.stringify({
            payments_enabled: Boolean(config?.payments_enabled),
            cash_enabled: Boolean(config?.cash_enabled),
            card_enabled: Boolean(config?.card_enabled),
            rate_per_minute: Number(config?.rate_per_minute ?? 1.67),
            rate_unit: config?.rate_unit || "minute",
        });
    }

    function isCameraSetupAlreadyApplied(config, assignments, savedSetup) {
        return Boolean(savedSetup) && normalizeCameraSetup(config, assignments) === savedSetup;
    }

    function isBillingConfigAlreadyApplied(config, savedConfig) {
        return Boolean(savedConfig) && normalizeBillingConfig(config) === savedConfig;
    }

    function openSettingsConfirmation(section) {
        setConfirmationSection(section);
        setConfirmationOpen(true);
    }

    function closeSettingsConfirmation() {
        if (settingsSubmitting) return;
        setConfirmationOpen(false);
        setConfirmationSection(null);
    }

    async function confirmCameraSettings() {
        if (settingsSubmitting) return;
        setSettingsSubmitting("camera");
        try {
            const payload = {
                entry_lane_cameras: Number(cameraConfig.entry_lane_cameras),
                exit_lane_cameras: Number(cameraConfig.exit_lane_cameras),
            };
            const result = await saveCameraConfig(token, payload);
            const savedConfig = result?.camera_config || payload;
            const normalizedConfig = {
                entry_lane_cameras: String(savedConfig.entry_lane_cameras),
                exit_lane_cameras: String(savedConfig.exit_lane_cameras),
            };
            setCameraConfig(normalizedConfig);
            setSavedCameraSetup(normalizeCameraSetup(normalizedConfig, cameraAssignments));
            setCameraMessageType("success");
            setCameraMessage(t.camerasSaved);
            localStorage.setItem(GARAGE_SETTINGS_UPDATED_KEY, String(Date.now()));
            setConfirmationOpen(false);
            setConfirmationSection(null);
        } catch {
            setCameraMessageType("warning");
            setCameraMessage(t.requestFailed);
        } finally {
            setSettingsSubmitting(null);
        }
    }

    async function confirmBillingSettings() {
        if (settingsSubmitting) return;
        setSettingsSubmitting("billing");
        try {
            const payload = {
                ...billingConfig,
                rate_per_minute: Number(billingConfig.rate_per_minute),
            };
            const result = await saveBillingConfig(token, payload);
            const savedConfig = result?.billing_config || payload;
            setBillingConfig(savedConfig);
            setSavedBillingConfig(normalizeBillingConfig(savedConfig));
            setBillingMessageType("success");
            setBillingMessage(t.billingApplied);
            localStorage.setItem(GARAGE_SETTINGS_UPDATED_KEY, String(Date.now()));
            setConfirmationOpen(false);
            setConfirmationSection(null);
        } catch {
            setBillingMessageType("warning");
            setBillingMessage(t.requestFailed);
        } finally {
            setSettingsSubmitting(null);
        }
    }
    function isGarageSettingsAlreadyApplied(currentSettings, savedSettings) {
        if (!currentSettings || !savedSettings) {
            return false;
        }

        if ((currentSettings.mode || "parking") !== (savedSettings.mode || "parking")) {
            return false;
        }

        const currentLevels = currentSettings.levels || [];
        const savedLevels = savedSettings.levels || [];

        if (currentLevels.length !== savedLevels.length) {
            return false;
        }

        if (Number(currentSettings.level_count) !== Number(savedSettings.level_count)) {
            return false;
        }

        if (Number(currentSettings.spaces_per_level) !== Number(savedSettings.spaces_per_level)) {
            return false;
        }

        if (Boolean(currentSettings.automatic_entry) !== Boolean(savedSettings.automatic_entry)) {
            return false;
        }
        if (Boolean(currentSettings.local_image_saving) !== Boolean(savedSettings.local_image_saving)) {
            return false;
        }

        return currentLevels.every((currentLevel, index) => {
            const savedLevel = savedLevels[index];

            return (
                String(currentLevel.name).trim() === String(savedLevel.name).trim() &&
                Number(currentLevel.spaces) === Number(savedLevel.spaces)
            );
        });
    }

    function validateGarageField(field, value) {
        const stringVal = String(value).trim();
        if (stringVal === "") {
            return t.required;
        }

        const numericValue = Number(stringVal);
        if (stringVal === "0" || numericValue === 0) {
            return t.zero;
        }

        if (!Number.isInteger(numericValue) || numericValue < 1) {
            return t.positiveNumber;
        }

        if (field === "levels" && numericValue > MAX_GARAGE_LEVELS) {
            return t.maxLevels;
        }

        return "";
    }

    function updateLevelCount(nextLevelCount) {
        const cleanedValue = nextLevelCount.replace(/[^\d]/g, "");

        const errorMessage = validateGarageField("levels", cleanedValue);
        setGarageErrors((current) => ({
            ...current,
            levels: errorMessage,
        }));
        setLevelErrors({});

        if (errorMessage === "") {
            setGarageSettingsMessage("");
        }

        setGarageSettings((current) => {
            if (!cleanedValue) {
                return {
                    ...current,
                    level_count: cleanedValue,
                    levels: [],
                };
            }

            const numericCount = Math.min(MAX_GARAGE_LEVELS, Math.max(1, Number(cleanedValue) || 1));
            const existingLevels = current.levels || [];
            const nextLevels = Array.from({ length: numericCount }, (_, index) => {
                const levelNumber = index + 1;
                const existingLevel = existingLevels[index] || existingLevels.find((level) => level.id === levelNumber);
                const masterSpaces = current.spaces_per_level;
                const resolvedSpaces = masterSpaces === "" ? (existingLevel?.spaces ?? "") : Number(masterSpaces) || existingLevel?.spaces || "";

                return {
                    id: levelNumber,
                    name: existingLevel?.name || `${t.levels} ${levelNumber}`,
                    spaces: resolvedSpaces,
                };
            });

            return {
                ...current,
                level_count: cleanedValue,
                levels: nextLevels,
            };
        });
    }

    function handleSpacesPerLevelChange(nextSpacesValue) {
        const cleanedValue = nextSpacesValue.replace(/[^\d]/g, "");

        const errorMessage = validateGarageField("spaces_per_level", cleanedValue);
        setGarageErrors((current) => ({
            ...current,
            spaces_per_level: errorMessage,
        }));
        setLevelErrors({});

        if (errorMessage === "") {
            setGarageSettingsMessage("");
        }

        setGarageSettings((current) => ({
            ...current,
            spaces_per_level: cleanedValue,
            levels: (current.levels || []).map((level) => ({
                ...level,
                spaces: cleanedValue === "" ? "" : Number(cleanedValue),
            })),
        }));
    }

    function updateLevel(index, field, value) {
        const level = garageSettings.levels?.[index];
        const nextValue = field === "spaces" ? value.replace(/[^\d]/g, "") : value;
        const errorMessage = field === "spaces"
            ? validateGarageField("spaces_per_level", nextValue)
            : (nextValue.trim() ? "" : t.required);

        if (level) {
            setLevelErrors((current) => ({
                ...current,
                [level.id]: {
                    ...current[level.id],
                    [field]: errorMessage,
                },
            }));
        }

        setGarageSettings((current) => ({
            ...current,
            levels: (current.levels || []).map((level, levelIndex) => {
                if (levelIndex !== index) return level;
                return {
                    ...level,
                    [field]: nextValue,
                };
            }),
        }));
    }

    function validateAdvancedLevels(levels) {
        const errors = {};
        let hasError = false;

        for (const level of levels || []) {
            const name = String(level.name ?? "").trim();
            const spaces = level.spaces === undefined || level.spaces === null ? "" : String(level.spaces);
            const nameError = name ? "" : t.required;
            const spacesError = validateGarageField("spaces_per_level", spaces);

            if (nameError || spacesError) {
                hasError = true;
            }
            errors[level.id] = { name: nameError, spaces: spacesError };
        }

        return { errors, hasError };
    }

    // The actual save payload (payloadLevels in confirmGarageSettings) is
    // always built from garageSettings.levels, whether or not the advanced
    // editor is open -- so summing per-level spaces is the true effective
    // total in both basic mode (where every level is kept in sync with the
    // shared spaces-per-level field) and advanced mode (independent values).
    function computeGarageTotalSpaces(levels) {
        return (levels || []).reduce((total, level) => total + (Number(level.spaces) || 0), 0);
    }

    function buildGarageCapacityError(total) {
        if (total <= MAX_TOTAL_PARKING_SPACES) return "";
        const capLabel = MAX_TOTAL_PARKING_SPACES.toLocaleString();
        const totalLabel = total.toLocaleString();
        return advancedGarageSettings
            ? `${GARAGE_CAPACITY_ERROR_PREFIX} ${capLabel} spaces. The configured levels currently exceed this limit. Current configuration: ${totalLabel} spaces.`
            : `${GARAGE_CAPACITY_ERROR_PREFIX} ${capLabel} spaces. Reduce the number of levels or spaces per level. Current configuration: ${totalLabel} spaces.`;
    }

    function handleGarageSettingsApply(event) {
        event.preventDefault();
        if (settingsSubmitting === "garage") return;
        if (garageSettingsAlreadyApplied) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage("These garage settings are already applied.");
            setConfirmationOpen(false);
            return;
        }
        if (garageSettings.mode === "tracking") {
            setGarageErrors({ levels: "", spaces_per_level: "" });
            setLevelErrors({});
            openSettingsConfirmation("garage");
            return;
        }
        const levelCountValue = garageSettings.level_count !== undefined
            ? garageSettings.level_count
            : (garageSettings.levels?.length ? String(garageSettings.levels.length) : "");
        const spacesPerLevelValue = garageSettings.spaces_per_level !== undefined
            ? String(garageSettings.spaces_per_level)
            : "";

        const levelsError = validateGarageField("levels", levelCountValue);
        const spacesError = validateGarageField("spaces_per_level", spacesPerLevelValue);

        const nextErrors = {
            levels: levelsError,
            spaces_per_level: spacesError,
        };

        setGarageErrors(nextErrors);

        const hasError = Object.values(nextErrors).some((message) => Boolean(message));
        const advancedValidation = advancedGarageSettings
            ? validateAdvancedLevels(garageSettings.levels)
            : { errors: {}, hasError: false };
        setLevelErrors(advancedValidation.errors);

        if (hasError || advancedValidation.hasError) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage(t.fixErrors);
            setConfirmationOpen(false);
            return;
        }

        const capacityError = buildGarageCapacityError(computeGarageTotalSpaces(garageSettings.levels));
        if (capacityError) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage(capacityError);
            setConfirmationOpen(false);
            return;
        }

        setGarageSettingsMessageType("success");
        setGarageSettingsMessage("");
        openSettingsConfirmation("garage");
    }

    async function confirmGarageSettings() {
        if (settingsSubmitting) return;
        if (garageSettings.mode === "tracking") {
            setSettingsSubmitting("garage");
            try {
                const result = await saveGarageSettings(token, {
                    mode: "tracking",
                    level_count: Number(garageSettings.level_count) || 0,
                    spaces_per_level: Number(garageSettings.spaces_per_level) || 0,
                    levels: (garageSettings.levels || []).map((level, index) => ({
                        id: level.id || index + 1,
                        name: String(level.name).trim(),
                        spaces: Number(level.spaces),
                    })),
                    automatic_entry: Boolean(garageSettings.automatic_entry),
                    local_image_saving: Boolean(garageSettings.local_image_saving),
                });
                const saved = result.garage_settings;
                if (pendingLocalImageFolder) {
                    setLocalImageFolder(await activatePlateImageFolder(pendingLocalImageFolder.handle));
                    setPendingLocalImageFolder(null);
                }
                const normalizedSaved = {
                    mode: "tracking",
                    level_count: String(saved.level_count),
                    spaces_per_level: String(saved.spaces_per_level),
                    levels: (saved.levels || []).map((level) => ({ ...level, spaces: String(level.spaces) })),
                    automatic_entry: Boolean(saved.automatic_entry),
                    local_image_saving: Boolean(saved.local_image_saving),
                };
                setGarageSettings(normalizedSaved);
                setSavedGarageSettings(normalizedSaved);
                setGarageSettingsMessageType("success"); setGarageSettingsMessage("Plate tracking mode applied."); localStorage.setItem(GARAGE_SETTINGS_UPDATED_KEY, String(Date.now())); emitParkingDataUpdated(); setConfirmationOpen(false); return;
            } catch (err) { setGarageSettingsMessageType("warning"); setGarageSettingsMessage(err?.message || t.requestFailed); return; }
            finally { setSettingsSubmitting(null); }
        }
        const levelCountVal = garageSettings.level_count !== undefined
            ? garageSettings.level_count
            : (garageSettings.levels?.length ? String(garageSettings.levels.length) : "");
        const spacesPerLevelVal = garageSettings.spaces_per_level !== undefined
            ? String(garageSettings.spaces_per_level)
            : "";

        const levelsError = validateGarageField("levels", levelCountVal);
        const spacesError = validateGarageField("spaces_per_level", spacesPerLevelVal);
        const advancedValidation = advancedGarageSettings
            ? validateAdvancedLevels(garageSettings.levels)
            : { errors: {}, hasError: false };

        setGarageErrors({ levels: levelsError, spaces_per_level: spacesError });
        setLevelErrors(advancedValidation.errors);

        if (levelsError || spacesError || advancedValidation.hasError) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage(t.fixErrors);
            setConfirmationOpen(false);
            return;
        }

        const capacityError = buildGarageCapacityError(computeGarageTotalSpaces(garageSettings.levels));
        if (capacityError) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage(capacityError);
            setConfirmationOpen(false);
            return;
        }
        const count = Number(levelCountVal);
        const defaultSpaces = Number(spacesPerLevelVal);

        const payloadLevels = (garageSettings.levels || []).map((level, index) => ({
            id: index + 1,
            name: String(level.name).trim(),
            spaces: Number(level.spaces),
        }));

        setSettingsSubmitting("garage");
        try {
            const result = await saveGarageSettings(token, {
                mode: "parking",
                level_count: count,
                spaces_per_level: defaultSpaces,
                levels: payloadLevels,
                automatic_entry: Boolean(garageSettings.automatic_entry),
                local_image_saving: Boolean(garageSettings.local_image_saving),
            });
            const savedSettings = result?.garage_settings || {
                mode: "parking",
                level_count: count,
                spaces_per_level: defaultSpaces,
                levels: payloadLevels,
                automatic_entry: Boolean(garageSettings.automatic_entry),
                local_image_saving: Boolean(garageSettings.local_image_saving),
            };
            if (pendingLocalImageFolder) {
                setLocalImageFolder(await activatePlateImageFolder(pendingLocalImageFolder.handle));
                setPendingLocalImageFolder(null);
            }
            setSavedGarageSettings({
                mode: savedSettings.mode || "parking",
                level_count: String(savedSettings.level_count),
                spaces_per_level: String(savedSettings.spaces_per_level),
                automatic_entry: Boolean(savedSettings.automatic_entry),
                local_image_saving: Boolean(savedSettings.local_image_saving),
                levels: (savedSettings.levels || payloadLevels).map((level) => ({
                    ...level,
                    spaces: String(level.spaces),
                })),
            });
            setGarageSettings((current) => ({
                ...current,
                mode: savedSettings.mode || "parking",
                level_count: String(count),
                spaces_per_level: String(defaultSpaces),
                automatic_entry: Boolean(savedSettings.automatic_entry),
                local_image_saving: Boolean(savedSettings.local_image_saving),
                levels: payloadLevels.map((l) => ({ ...l, spaces: String(l.spaces) })),
            }));
            setGarageSettingsMessageType("success");
            setGarageSettingsMessage(t.garageApplied);
            localStorage.setItem(GARAGE_SETTINGS_UPDATED_KEY, String(Date.now()));
            emitParkingDataUpdated();
            setConfirmationOpen(false);
            setConfirmationSection(null);
        } catch (err) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage(err?.message || t.requestFailed);
            setConfirmationOpen(false);
            setConfirmationSection(null);
        } finally {
            setSettingsSubmitting(null);
        }
    }

    if (loading) return <main className={`admin-shell admin-theme-${appliedTheme} admin-loading`} dir={isUrdu ? "rtl" : "ltr"} lang={language}>{t.checkingSession}</main>;

    if (token) {
        return (
            <main className={`admin-shell admin-theme-${appliedTheme}`} dir={isUrdu ? "rtl" : "ltr"} lang={language}>
                <header className="admin-header">
                    <a href="/" className="admin-logo">PARKING<span>OS</span></a>
                    <div className="admin-header-actions"><button type="button" className="theme-toggle" onClick={() => openOrFocusNamedTab("/", "parkingos-garage")}>Open Garage</button><div className="account-menu"><button type="button" className="admin-user" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>{adminName}</button>{accountMenuOpen && <div className="account-dropdown"><strong>Appearance</strong><button onClick={() => { setTheme("system"); setAccountMenuOpen(false); }}>System Default</button><button onClick={() => { setTheme("light"); setAccountMenuOpen(false); }}>Light</button><button onClick={() => { setTheme("dark"); setAccountMenuOpen(false); }}>Dark</button><strong>Language</strong><button onClick={() => { setLanguage("en"); setAccountMenuOpen(false); }}>English</button><button onClick={() => { setLanguage("ur"); setAccountMenuOpen(false); }}>Urdu</button><strong>Account</strong><button onClick={openSecurityModal}>Account Security</button><button className="sign-out" onClick={signOut}>{t.signOut}</button></div>}</div></div>
                </header>
                <div className="admin-app-body">
                    <aside className="admin-sidebar">
                        <p className="admin-label">{t.controlCenter}</p>
                        <button type="button" className={`sidebar-feature ${activeFeature === "whitelist" ? "active" : ""}`} onClick={() => { setActiveFeature(activeFeature === "whitelist" ? null : "whitelist"); setWhitelistError(""); }}>
                            <span className="feature-number">01</span><span>{t.whitelist}</span><span className="feature-arrow">{activeFeature === "whitelist" ? "−" : "+"}</span>
                        </button>
                        <button type="button" className={`sidebar-feature ${activeFeature === "garage-settings" ? "active" : ""}`} onClick={() => setActiveFeature(activeFeature === "garage-settings" ? null : "garage-settings")}>
                            <span className="feature-number">02</span><span>{t.garageSettings}</span><span className="feature-arrow">{activeFeature === "garage-settings" ? "−" : "+"}</span>
                        </button>
                        <button type="button" className={`sidebar-feature ${activeFeature === "camera-config" ? "active" : ""}`} onClick={() => setActiveFeature(activeFeature === "camera-config" ? null : "camera-config")}>
                            <span className="feature-number">03</span><span>{t.cameraSetup}</span><span className="feature-arrow">{activeFeature === "camera-config" ? "−" : "+"}</span>
                        </button>
                        <button type="button" className={`sidebar-feature ${activeFeature === "billing" ? "active" : ""}`} onClick={() => setActiveFeature(activeFeature === "billing" ? null : "billing")}>
                            <span className="feature-number">04</span><span>{t.billing}</span><span className="feature-arrow">{activeFeature === "billing" ? "−" : "+"}</span>
                        </button>
                        <button type="button" className={`sidebar-feature ${activeFeature === "parking-activity" ? "active" : ""}`} onClick={() => { setActiveFeature("parking-activity"); loadParkingActivity(); }}>
                            <span className="feature-number">05</span><span>Parking Activity</span><span className="feature-arrow">+</span>
                        </button>
                        <button type="button" className={`sidebar-feature ${activeFeature === "analytics" ? "active" : ""}`} onClick={() => { setActiveFeature("analytics"); loadAnalytics(); }}><span className="feature-number">06</span><span>Analytics</span><span className="feature-arrow">+</span></button>
                    </aside>
                    <section className="admin-dashboard">
                        {activeFeature === "parking-activity" ? (
                            <div className="feature-view">
                                <h1>Parking<br /><span>activity.</span></h1>
                                <p className="admin-message">Live parking, recent visits, and active space status.</p>
                                <button type="button" className="activity-refresh" onClick={loadParkingActivity} disabled={activityLoading} aria-label="Refresh activity"><span className={activityLoading ? "spinning" : ""}>↻</span></button>

                                <div className="level-config-block">
                                    <button
                                        type="button"
                                        onClick={() => setActivityExportOpen((open) => !open)}
                                        aria-expanded={activityExportOpen}
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: "12px",
                                            padding: "12px 14px",
                                            border: "0",
                                            background: "transparent",
                                            cursor: "pointer",
                                            textAlign: "left",
                                            font: "inherit",
                                            color: "inherit",
                                        }}
                                    >
                                        <strong>Export parking history</strong>
                                        <span aria-hidden="true">
                                            {activityExportOpen ? "−" : "+"}
                                        </span>
                                    </button>

                                    {activityExportOpen && (
                                        <>
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "16px", marginTop: "18px", marginBottom: "32px" }}>
                                                <label className="level-count-field camera-field-group" style={{ alignItems: "flex-start" }}>
                                                    <span>Time frame</span>
                                                    <select
                                                        className="language-select"
                                                        value={activityExportRange}
                                                        onChange={(event) => {
                                                            setActivityExportRange(event.target.value);
                                                            setActivityExportError("");
                                                        }}
                                                    >
                                                        <option value="1h">Last hour</option>
                                                        <option value="24h">Last 24 hours</option>
                                                        <option value="7d">Last 7 days</option>
                                                        <option value="30d">Last 30 days</option>
                                                        <option value="custom">Custom</option>
                                                    </select>
                                                </label>

                                                {activityExportRange === "custom" && (
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-start" }}>
                                                        <label className="level-count-field camera-field-group" style={{ alignItems: "flex-start" }}>
                                                            <span>From</span>
                                                            <input
                                                                type="datetime-local"
                                                                value={activityExportCustomStart}
                                                                onChange={(event) => {
                                                                    setActivityExportCustomStart(event.target.value);
                                                                    setActivityExportError("");
                                                                }}
                                                            />
                                                        </label>

                                                        <label className="level-count-field camera-field-group" style={{ alignItems: "flex-start" }}>
                                                            <span>To</span>
                                                            <input
                                                                type="datetime-local"
                                                                value={activityExportCustomEnd}
                                                                onChange={(event) => {
                                                                    setActivityExportCustomEnd(event.target.value);
                                                                    setActivityExportError("");
                                                                }}
                                                            />
                                                        </label>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="billing-payment-methods">
                                                <p className="billing-subtitle">Tables to include</p>

                                                <div className="payment-options">
                                                    {PARKING_ACTIVITY_EXPORT_TABLES.map((table) => (
                                                        <label className="payment-option" key={table.id}>
                                                            <input
                                                                type="checkbox"
                                                                className="payment-checkbox"
                                                                checked={Boolean(activityExportTables[table.id])}
                                                                onChange={() => toggleActivityExportTable(table.id)}
                                                            />
                                                            <span className="payment-method-name">{table.label}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>

                                            <p className="form-hint">
                                                One selected table downloads as a CSV. Multiple selected tables download together in one ZIP file. Space Status is a current snapshot.
                                            </p>

                                            {activityExportError && (
                                                <p className="admin-error whitelist-feedback">
                                                    {activityExportError}
                                                </p>
                                            )}

                                            <div className="settings-actions">
                                                <button
                                                    type="button"
                                                    className="settings-save-button"
                                                    onClick={handleParkingActivityExport}
                                                    disabled={!parkingActivity || activityLoading}
                                                >
                                                    Download Activity <span>↓</span>
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {activityError && <p className="admin-error whitelist-feedback">{activityError}</p>}
                                {parkingActivity && <>
                                    <p className="admin-message">Capacity: {parkingActivity.space_status.total_active_capacity} · Occupied: {parkingActivity.space_status.occupied} · Available: {parkingActivity.space_status.available}</p>
                                    <div className="whitelist-table-wrap"><table><thead><tr><th>Live plate</th><th>Space</th><th>Entry time</th><th>Duration</th><th>Actions</th></tr></thead><tbody>{parkingActivity.live_sessions.map((session) => <tr key={session.session_id}><td>{session.plate}</td><td>{session.space || "Tracking"}</td><td>{new Date(session.entry_time).toLocaleString()}</td><td>{session.duration_minutes} min</td><td><div className="vehicle-menu"><button type="button" className="vehicle-menu-trigger" aria-label="Vehicle actions" aria-expanded={activeSessionMenuId === session.session_id} onClick={(event) => toggleSessionMenu(session.session_id, event.currentTarget)}>⋮</button>{renderSessionMenu(session)}</div></td></tr>)}</tbody></table></div>
                                    <div className="whitelist-table-wrap"><table><thead><tr><th>Level</th><th>Space</th><th>Status</th><th>Plate</th></tr></thead><tbody>{parkingActivity.space_status.spaces.map((space) => <tr key={`${space.level}-${space.space}`}><td>{space.level}</td><td>{space.space}</td><td>{space.is_occupied ? "Occupied" : "Available"}</td><td>{space.plate || "-"}</td></tr>)}</tbody></table></div>
                                    <div className="whitelist-table-wrap"><table><thead><tr><th>Plate</th><th>Visits</th><th>Last entry</th><th>Last exit</th><th>Parked</th><th>Whitelist</th></tr></thead><tbody>{parkingActivity.vehicles.map((vehicle) => <tr key={vehicle.plate}><td>{vehicle.plate}</td><td>{vehicle.total_visits}</td><td>{vehicle.last_entry ? new Date(vehicle.last_entry).toLocaleString() : "-"}</td><td>{vehicle.last_exit ? new Date(vehicle.last_exit).toLocaleString() : "-"}</td><td>{vehicle.currently_parked ? "Yes" : "No"}</td><td>{vehicle.whitelisted ? "Yes" : "No"}</td></tr>)}</tbody></table></div>
                                    <div className="whitelist-table-wrap"><table><thead><tr><th>Plate</th><th>Entry</th><th>Exit</th><th>Duration</th><th>Space</th>{parkingActivity.billing_enabled && <><th>Payment</th><th>Amount</th><th>Discount</th></>}</tr></thead><tbody>{parkingActivity.history.map((item, index) => <tr key={`${item.plate}-${index}`}><td>{item.plate}</td><td>{new Date(item.entry_time).toLocaleString()}</td><td>{item.exit_time ? new Date(item.exit_time).toLocaleString() : "-"}</td><td>{item.duration_minutes} min</td><td>{item.space || "-"}</td>{parkingActivity.billing_enabled && <><td>{item.payment_method || "-"}</td><td>{item.amount ?? "-"}</td><td>{item.discount_percent ? `${item.discount_percent}%` : "-"}</td></>}</tr>)}</tbody></table></div>
                                </>}
                            </div>
                        ) : activeFeature === "analytics" ? (
                            <div className="feature-view">
                                <h1>Garage<br /><span>analytics.</span></h1>
                                {analytics ? (
                                    <>
                                        <div className="analytics-grid">
                                            <article>
                                                <span className="analytics-grid-label">Total Earnings</span>
                                                <strong>Rs {Number(analytics.total_earnings).toLocaleString("en-PK", { minimumFractionDigits: 2 })}</strong>
                                            </article>
                                            <article>
                                                <span className="analytics-grid-label">Average Duration</span>
                                                <strong>{formatAnalyticsDuration(analytics.average_duration_minutes)}</strong>
                                            </article>
                                            <article>
                                                <span className="analytics-grid-label">Rush Hour</span>
                                                <strong>{formatRushHourRange(analytics.rush_hour)}</strong>
                                            </article>
                                            <article>
                                                <span className="analytics-grid-label">Occupancy</span>
                                                <strong>{analytics.occupancy.occupied}/{analytics.occupancy.total}</strong>
                                            </article>
                                            <article>
                                                <span className="analytics-grid-label">Vehicles Today</span>
                                                <strong>{analytics.vehicles_today}</strong>
                                            </article>
                                        </div>

                                        <section className="analytics-panel">
                                            <div className="analytics-switcher">
                                                {ANALYTICS_METRICS.map(({ key, label }) => (
                                                    <button key={key} type="button" className={analyticsMetric === key ? "active" : ""} onClick={() => setAnalyticsMetric(key)}>{label}</button>
                                                ))}
                                            </div>
                                            <h3>{ANALYTICS_METRIC_TITLES[analyticsMetric]}</h3>
                                            <div className="analytics-bars">{renderAnalyticsBars()}</div>
                                        </section>
                                    </>
                                ) : (
                                    <p className="admin-message">Loading analytics…</p>
                                )}
                            </div>
                        ) : activeFeature === "whitelist" ? (
                            <div className="feature-view">
                                <h1>{t.vehicleTitle}<br /><span>{t.whitelistTitle}</span></h1>
                                <p className="admin-message">{t.vehicleIntro}</p>
                                <div className="whitelist-actions">
                                    <form className="whitelist-card" onSubmit={submitWhitelist}><div className="card-heading"><span>01</span><h2>{t.addVehicle}</h2></div><label htmlFor="plate">{t.numberPlate}</label><input id="plate" value={plate} onChange={(event) => setPlate(event.target.value)} placeholder={t.examplePlate} required /><label htmlFor="vehicle-name">{t.name}</label><input id="vehicle-name" value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} placeholder={t.exampleManager} required /><label htmlFor="discount">{t.discountPercentage}</label><input id="discount" type="number" min="0" max="100" step="1" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="0 - 100" required /><button type="submit" disabled={whitelistLoading}>{t.addToWhitelist} <span>→</span></button></form>
                                    <form className="whitelist-card remove-card" onSubmit={submitRemove}><div className="card-heading"><span>02</span><h2>{t.removeVehicle}</h2></div><label htmlFor="remove-search">{t.nameOrPlate}</label><input id="remove-search" value={removeSearch} onChange={(event) => setRemoveSearch(event.target.value)} placeholder={t.searchList} required /><p className="form-hint">{t.removeHint}</p><button type="submit" disabled={whitelistLoading}>{t.removeFromList} <span>→</span></button></form>
                                </div>
                                {whitelistError && <p className="admin-error whitelist-feedback">{whitelistError}</p>}
                                {whitelistMessage && <p className="whitelist-success">{whitelistMessage}</p>}
                                <button type="button" className="show-list-button" onClick={showWhitelist}>{whitelistVisible ? t.hideList : t.showList} <span>{whitelistListLoading ? "..." : whitelistVisible ? "↑" : "↓"}</span></button>
                                {whitelistVisible && <div className={`whitelist-table-wrap${whitelistListLoading || whitelist.length === 0 ? " admin-loading" : ""}`}>{whitelistListLoading ? "Loading list..." : whitelist.length > 0 ? <table><thead><tr><th>{t.name}</th><th>{t.numberPlate}</th><th>{t.discount}</th><th>{t.added}</th></tr></thead><tbody>{whitelist.map((entry) => <tr key={entry.id}><td>{entry.vehicle_name}</td><td>{entry.license_plate}</td><td>{entry.discount_percent}%</td><td>{entry.created_at ? new Date(entry.created_at).toLocaleDateString(language === "ur" ? "ur-PK" : "en-PK", { timeZone: "Asia/Karachi" }) : "-"}</td></tr>)}</tbody></table> : "No whitelist entries."}</div>}
                            </div>
                        ) : activeFeature === "garage-settings" ? (
                            <div className="feature-view">
                                <h1>{t.garageTitle}<br /><span>{t.layoutTitle}</span></h1>
                                <p className="admin-message">{t.garageIntro}</p>

                                <form className="garage-settings-form" onSubmit={handleGarageSettingsApply}>
                                    <div className="garage-mode-options"><p>Choose how this site is operated.</p><label><input type="radio" checked={(garageSettings.mode || "parking") === "parking"} onChange={() => setGarageSettings((current) => ({ ...current, mode: "parking" }))} /> <strong>Parking Garage</strong><small>Manage levels, spaces, entry, exit and billing.</small></label><label><input type="radio" checked={garageSettings.mode === "tracking"} onChange={() => setGarageSettings((current) => ({ ...current, mode: "tracking" }))} /> <strong>Plate Tracking Only</strong><small>Recognize and log plates without parking-space assignment.</small></label></div>
                                    <label className="automatic-entry-toggle">
                                        <span>Automatic Entry</span>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(garageSettings.automatic_entry)}
                                            onChange={(event) => setGarageSettings((current) => ({ ...current, automatic_entry: event.target.checked }))}
                                        />
                                    </label>
                                    {(garageSettings.mode || "parking") === "parking" && <>
                                        <div className="level-config-block">
                                            <div className="level-config-header">
                                                <label className="level-count-field garage-field-group">
                                                    <span>{t.levels}</span>
                                                    <input
                                                        aria-describedby="garage-levels-error"
                                                        aria-invalid={Boolean(garageErrors.levels)}
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        value={garageSettings.level_count !== undefined ? garageSettings.level_count : (garageSettings.levels?.length ? String(garageSettings.levels.length) : "")}
                                                        onChange={(event) => updateLevelCount(event.target.value)}
                                                    />
                                                    <small id="garage-levels-error" className="admin-error whitelist-feedback error-space">
                                                        {garageErrors.levels || "\u00A0"}
                                                    </small>
                                                </label>
                                                <label className="level-count-field garage-field-group">
                                                    <span>{t.spacesPerLevel}</span>
                                                    <input
                                                        aria-describedby="garage-spaces-error"
                                                        aria-invalid={Boolean(garageErrors.spaces_per_level)}
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        value={garageSettings.spaces_per_level}
                                                        onChange={(event) => handleSpacesPerLevelChange(event.target.value)}
                                                    />
                                                    <small id="garage-spaces-error" className="admin-error whitelist-feedback error-space">
                                                        {garageErrors.spaces_per_level || "\u00A0"}
                                                    </small>
                                                </label>
                                            </div>
                                            <div className="local-image-setting"><label><span>Enable Local Plate Images</span><input type="checkbox" checked={Boolean(garageSettings.local_image_saving)} onChange={(event) => setGarageSettings((current) => ({ ...current, local_image_saving: event.target.checked }))} /></label><button type="button" className="camera-refresh-button" onClick={chooseLocalImageFolder}>Select Folder</button><div className="local-image-status"><small>{localImageFolder ? <>Selected folder: <strong>{localImageFolder}</strong><br />Saving structure: {localImageFolder} / YYYY-MM-DD / Entry | Exit</> : localPlateImageSupport() ? "No local folder selected." : "Local folder saving requires Chromium."}</small>{localImageStatus && <small>{localImageStatus}</small>}</div></div>
                                        </div>

                                        {advancedGarageSettings && (
                                            <div className="advanced-level-editor">
                                                <h4>{t.advancedEditor}</h4>
                                                <p className="advanced-hint">{t.advancedHint}</p>
                                                {(garageSettings.levels || []).map((level, index) => (
                                                    <div key={level.id || index} className="advanced-level-row">
                                                        <label>
                                                            <span>{t.levelName}</span>
                                                            <input
                                                                aria-describedby={`garage-level-${level.id}-name-error`}
                                                                aria-invalid={Boolean(levelErrors[level.id]?.name)}
                                                                value={level.name}
                                                                onChange={(event) => updateLevel(index, "name", event.target.value)}
                                                            />
                                                            <small id={`garage-level-${level.id}-name-error`} className="admin-error whitelist-feedback error-space">
                                                                {levelErrors[level.id]?.name || "\u00A0"}
                                                            </small>
                                                        </label>
                                                        <label>
                                                            <span>{t.spaces}</span>
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                pattern="[0-9]*"
                                                                aria-describedby={`garage-level-${level.id}-spaces-error`}
                                                                aria-invalid={Boolean(levelErrors[level.id]?.spaces)}
                                                                value={level.spaces ?? ""}
                                                                onChange={(event) => updateLevel(index, "spaces", event.target.value)}
                                                            />
                                                            <small id={`garage-level-${level.id}-spaces-error`} className="admin-error whitelist-feedback error-space">
                                                                {levelErrors[level.id]?.spaces || "\u00A0"}
                                                            </small>
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                    </>}{garageSettings.mode === "tracking" && <div className="local-image-setting"><label><span>Enable Local Plate Images</span><input type="checkbox" checked={Boolean(garageSettings.local_image_saving)} onChange={(event) => setGarageSettings((current) => ({ ...current, local_image_saving: event.target.checked }))} /></label><button type="button" className="camera-refresh-button" onClick={chooseLocalImageFolder}>Select Folder</button><div className="local-image-status"><small>{localImageFolder ? <>Selected folder: <strong>{localImageFolder}</strong><br />Saving structure: {localImageFolder} / YYYY-MM-DD / Entry | Exit</> : localPlateImageSupport() ? "No local folder selected." : "Local folder saving requires Chromium."}</small>{localImageStatus && <small>{localImageStatus}</small>}</div></div>}{garageSettingsMessage && (
                                        <p className={garageSettingsMessageType === "warning" ? "admin-error whitelist-feedback" : "whitelist-success"}>{garageSettingsMessage}</p>
                                    )}

                                    <div className="settings-actions">
                                        <button
                                            type="submit"
                                            className="settings-save-button"
                                            disabled={garageSettingsAlreadyApplied || settingsSubmitting === "garage"}
                                        >
                                            {garageSettingsAlreadyApplied ? "Already Applied" : t.apply}
                                            {!garageSettingsAlreadyApplied && <span>→</span>}
                                        </button>
                                        <button
                                            type="button"
                                            className="advanced-button"
                                            onClick={() => {
                                                setAdvancedGarageSettings((current) => {
                                                    const nextState = !current;
                                                    if (nextState) {
                                                        const nextSpaces = garageSettings.spaces_per_level || "";
                                                        handleSpacesPerLevelChange(nextSpaces);
                                                    }
                                                    return nextState;
                                                });
                                            }}
                                        >
                                            {t.advanced}
                                        </button>
                                    </div>
                                </form>

                            </div>
                        ) : activeFeature === "camera-config" ? (
                            <div className="feature-view">
                                <h1>{t.cameraTitle}<br /><span>{t.cameraSetupTitle}</span></h1>
                                <p className="admin-message">{t.cameraIntro}</p>
                                <p className="form-hint">Up to 4 cameras can be assigned across entry and exit lanes. {Math.min(4, safeEntryCameraCount + safeExitCameraCount)} of 4 assigned.</p>

                                <form className="garage-settings-form" onSubmit={handleCameraConfigSubmit}>
                                    <div className="level-config-block">
                                        <div className="level-config-header">
                                            <label className="level-count-field camera-field-group">
                                                <span>{t.entryCameras}</span>
                                                <input
                                                    className="camera-input"
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    value={cameraConfig.entry_lane_cameras}
                                                    onChange={(event) => handleCameraConfigChange("entry_lane_cameras", event.target.value)}
                                                    required
                                                />
                                                <small className="admin-error whitelist-feedback error-space">
                                                    {cameraErrors.entry_lane_cameras || "\u00A0"}
                                                </small>
                                            </label>
                                            <label className="level-count-field camera-field-group">
                                                <span>{t.exitCameras}</span>
                                                <input
                                                    className="camera-input"
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    value={cameraConfig.exit_lane_cameras}
                                                    onChange={(event) => handleCameraConfigChange("exit_lane_cameras", event.target.value)}
                                                    required
                                                />
                                                <small className="admin-error whitelist-feedback error-space">
                                                    {cameraErrors.exit_lane_cameras || "\u00A0"}
                                                </small>
                                            </label>
                                        </div>
                                    </div>

                                    {cameraMessage && (
                                        <p className={cameraMessageType === "warning" ? "admin-error whitelist-feedback camera-limit-warning" : "whitelist-success"} role={cameraMessageType === "warning" ? "alert" : undefined}>{cameraMessageType === "warning" && <span className="camera-warning-shield" aria-hidden="true">!</span>}{cameraMessage}</p>
                                    )}

                                    <div className="camera-assignments">
                                        <div className="camera-assignments-header">
                                            <div>
                                                <p className="camera-assignments-eyebrow">Browser devices</p>
                                                <strong>Browser camera assignments</strong>
                                            </div>
                                            <button type="button" className="camera-refresh-button" onClick={refreshCameraDevices} disabled={cameraDevicesLoading}>
                                                {cameraDevicesLoading ? "Refreshing..." : "Refresh cameras"}
                                            </button>
                                        </div>
                                        <div className="camera-assignment-list">
                                            {cameraSlots.map((slot) => {
                                                const assigned = cameraAssignments[slot.id] || "";
                                                const lane = slot.id.startsWith("entry-") ? "Entry" : "Exit";
                                                // The saved assignment (from a previous session) can reference a
                                                // device that isn't in `cameraDevices` yet -- enumerateDevices()
                                                // only runs when "Refresh cameras" is clicked, not on page load.
                                                // Without a matching <option>, the browser silently falls back to
                                                // showing "Not assigned" here while the status badge below (which
                                                // reads the same saved value directly) still says "Assigned",
                                                // which is a contradictory, confusing display -- not the actual
                                                // camera assignment being lost.
                                                const assignedDeviceKnown = assigned && cameraDevices.some((device) => device.deviceId === assigned);

                                                return (
                                                    <div key={slot.id} className="camera-assignment-card">
                                                        <div className="camera-assignment-title">
                                                            <span className={`camera-lane-badge ${lane.toLowerCase()}`}>{lane}</span>
                                                            <strong>{slot.label}</strong>
                                                            <code>{slot.id}</code>
                                                        </div>
                                                        <label className="camera-device-field">
                                                            <span>Device source</span>
                                                            <select
                                                                value={assigned}
                                                                onChange={(event) => setCameraAssignment(slot.id, event.target.value)}
                                                            >
                                                                <option value="">Not assigned</option>
                                                                {assigned && !assignedDeviceKnown && (
                                                                    <option value={assigned}>Saved camera (refresh to see its name)</option>
                                                                )}
                                                                {cameraDevices.map((device, index) => (
                                                                    <option key={device.deviceId} value={device.deviceId}>
                                                                        {device.label || `Camera ${index + 1}`}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </label>
                                                        <span className={`camera-assignment-status ${assigned ? "assigned" : "unassigned"}`}>
                                                            {assigned ? "Assigned" : "Not assigned"}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="settings-actions">
                                        <button type="submit" className="settings-save-button" disabled={cameraSetupAlreadyApplied || settingsSubmitting === "camera"}>
                                            {cameraSetupAlreadyApplied ? "Already Applied" : t.apply}
                                            {!cameraSetupAlreadyApplied && <span>→</span>}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ) : activeFeature === "billing" ? (
                            <div className="feature-view">
                                <h1>{t.paymentTitle}<br /><span>{t.paymentSettings}</span></h1>
                                <p className="admin-message">{t.paymentIntro}</p>

                                <form className="garage-settings-form" onSubmit={handleBillingApply}>
                                    <div className="billing-toggle-section">
                                        <label className="billing-toggle-label">
                                            <input type="checkbox" className="billing-checkbox" checked={billingConfig.payments_enabled} onChange={() => handleBillingToggle("payments_enabled")} />
                                            <span className="billing-toggle-text">{t.enablePayments}</span>
                                        </label>
                                    </div>

                                    {billingConfig.payments_enabled && (
                                        <>
                                            <div className="billing-rate-field">
                                                <label htmlFor="parking-rate-per-minute">Parking rate</label>
                                                <div><span>Rs</span><input id="parking-rate-per-minute" type="number" min="0.01" step="0.01" value={billingConfig.rate_per_minute} onChange={(event) => handleBillingRateChange(event.target.value)} aria-invalid={Boolean(billingRateError)} /><select value={billingConfig.rate_unit || "minute"} onChange={(event) => setBillingConfig((current) => ({ ...current, rate_unit: event.target.value }))}><option value="minute">Per minute</option><option value="hour">Per hour</option><option value="day">Per day</option></select></div>
                                                <small className="admin-error whitelist-feedback error-space">{billingRateError || "\u00A0"}</small>
                                            </div>
                                            <div className="billing-payment-methods">
                                                <p className="billing-subtitle">{t.acceptedPayments}</p>
                                                <div className="payment-options">
                                                    <label className="payment-option">
                                                        <input type="checkbox" className="payment-checkbox" checked={billingConfig.cash_enabled} onChange={() => handleBillingToggle("cash_enabled")} />
                                                        <span className="payment-method-name">💵 {t.cash}</span>
                                                    </label>
                                                    <label className="payment-option">
                                                        <input type="checkbox" className="payment-checkbox" checked={billingConfig.card_enabled} onChange={() => handleBillingToggle("card_enabled")} />
                                                        <span className="payment-method-name">💳 {t.card}</span>
                                                    </label>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {billingMessage && <p className={billingMessageType === "warning" ? "admin-error whitelist-feedback" : "whitelist-success"} role={billingMessageType === "warning" ? "alert" : undefined}>{billingMessage}</p>}

                                    <div className="settings-actions">
                                        <button type="submit" className="settings-save-button" disabled={billingAlreadyApplied || settingsSubmitting === "billing"}>
                                            {billingAlreadyApplied ? "Already Applied" : t.apply}
                                            {!billingAlreadyApplied && <span>→</span>}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ) : (
                            <div className="feature-view">
                                <p className="admin-label">{t.workspace}</p>
                                <h1>{t.welcomeBack}<br /><span>{adminName}.</span></h1>
                                <div className="admin-status"><b /> {t.online}</div>
                                <p className="admin-message">{t.workspaceIntro}</p>
                            </div>
                        )}
                    </section>
                    {confirmationOpen && (
                        <div className="confirmation-overlay" onClick={closeSettingsConfirmation}>
                            <div className="confirmation-dialog" onClick={(event) => event.stopPropagation()}>
                                <h3>{confirmationSection === "garage" ? t.confirmLayout : confirmationSection === "camera" ? "Confirm camera setup" : "Confirm billing setup"}</h3>
                                {confirmationSection === "garage" ? (
                                    <>
                                        <p><strong>{t.levels}:</strong> {garageSettings.level_count || garageSettings.levels?.length || 0}</p>
                                        <p><strong>{t.spacesPerLevel}:</strong> {garageSettings.spaces_per_level || 0}</p>
                                    </>
                                ) : confirmationSection === "camera" ? (
                                    <>
                                        <p>Apply the selected entry and exit camera counts.</p>
                                        <p><strong>{t.entryCameras}:</strong> {cameraConfig.entry_lane_cameras}</p>
                                        <p><strong>{t.exitCameras}:</strong> {cameraConfig.exit_lane_cameras}</p>
                                    </>
                                ) : (
                                    <p>Apply the selected billing and payment method settings.</p>
                                )}
                                <div className="confirmation-actions">
                                    <button type="button" className="confirmation-cancel" onClick={closeSettingsConfirmation} disabled={Boolean(settingsSubmitting)}>{t.cancel}</button>
                                    <button type="button" className="confirmation-confirm" disabled={Boolean(settingsSubmitting)} onClick={confirmationSection === "garage" ? confirmGarageSettings : confirmationSection === "camera" ? confirmCameraSettings : confirmBillingSettings}>{settingsSubmitting ? "Applying..." : t.confirm}</button>
                                </div>
                            </div>
                        </div>
                    )}
                    {securityModalOpen && (
                        <div className="confirmation-overlay" onClick={closeSecurityModal}>
                            <div className="confirmation-dialog" onClick={(event) => event.stopPropagation()}>
                                <h3>Account Security</h3>

                                {securityLoading && !securityStatus ? (
                                    <p>Loading...</p>
                                ) : securityStatus ? (
                                    <>
                                        <p>
                                            <strong>Email</strong><br />
                                            {securityStatus.email || "No email on file"}<br />
                                            <span className={securityStatus.email_verified ? "whitelist-success" : "admin-error"}>
                                                {securityStatus.email_verified ? "Verified" : "Not verified"}
                                            </span>
                                        </p>

                                        {!securityStatus.email_verified && !securityStatus.email && (
                                            <p className="admin-message">Add an email to your admin account before it can be verified.</p>
                                        )}

                                        {!securityStatus.email_verified && securityStatus.email && !securityEmailCodeSent && (
                                            <button type="button" className="confirmation-confirm" onClick={handleSendEmailVerification} disabled={securityLoading}>
                                                Verify email
                                            </button>
                                        )}

                                        {securityEmailCodeSent && (
                                            <form onSubmit={handleVerifyEmailCode}>
                                                <label htmlFor="security-email-code">Enter verification code</label>
                                                <input id="security-email-code" value={securityEmailCode} onChange={(event) => setSecurityEmailCode(event.target.value)} autoComplete="one-time-code" required />
                                                <button type="submit" className="confirmation-confirm" disabled={securityLoading}>Verify</button>
                                            </form>
                                        )}

                                        <p>
                                            <strong>Authenticator</strong><br />
                                            {securityStatus.totp_enabled ? "Enabled" : "Not configured"}
                                        </p>

                                        {!securityStatus.totp_enabled && !securityStatus.email_verified && (
                                            <p className="admin-message">Verify your email before setting up an authenticator.</p>
                                        )}

                                        {!securityStatus.totp_enabled && securityStatus.email_verified && !securityTotpSetup && (
                                            <button type="button" className="confirmation-confirm" onClick={handleSetupTotp} disabled={securityLoading}>
                                                Set up authenticator
                                            </button>
                                        )}

                                        {securityTotpSetup && (
                                            <div>
                                                <p>Setup key:</p>
                                                <p><code>{securityTotpSetup.secret}</code></p>
                                                <p className="admin-message">
                                                    Google Authenticator: tap + → Enter a setup key → Account name: Parking Garage → paste the key above → Time based.
                                                </p>
                                                <form onSubmit={handleConfirmTotp}>
                                                    <label htmlFor="security-totp-code">Enter the 6-digit code from your authenticator</label>
                                                    <input id="security-totp-code" value={securityTotpCode} onChange={(event) => setSecurityTotpCode(event.target.value)} autoComplete="one-time-code" required />
                                                    <button type="submit" className="confirmation-confirm" disabled={securityLoading}>Confirm authenticator</button>
                                                </form>
                                            </div>
                                        )}
                                    </>
                                ) : null}

                                {securityError && <p className="admin-error" role="alert">{securityError}</p>}
                                {securityMessage && <p className="whitelist-success" role="status">{securityMessage}</p>}

                                <div className="confirmation-actions">
                                    <button type="button" className="confirmation-cancel" onClick={closeSecurityModal}>Close</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className={`admin-shell admin-theme-${appliedTheme} admin-login-shell`} dir={isUrdu ? "rtl" : "ltr"} lang={language}>
            <section className="admin-welcome">
                <div className="admin-login-top"><a href="/" className="admin-logo">PARKING<span>OS</span></a><DisplayControls theme={theme} language={language} onLanguageChange={setLanguage} onThemeChange={setTheme} /></div>
                <div><p className="admin-label">{t.adminAccess}</p><h1>{t.makeEvery}<br /><span>{t.spaceCount}</span></h1><p className="admin-subtitle">{t.loginIntro}</p></div>
                <small>{t.secureAccess}</small>
            </section>
            <section className="admin-form-panel">
                <div className="admin-form-wrap">
                    {forgotPasswordOpen ? (
                        <>
                            {forgotStep === "forgot_identifier" && (
                                <>
                                    <p className="admin-label">{t.forgotPassword}</p>
                                    <h2>{t.forgotPasswordTitle}</h2>
                                    <form onSubmit={handleRecoveryIdentifierSubmit}>
                                        <label htmlFor="admin-forgot-identifier">{t.forgotPasswordHint}</label>
                                        <input id="admin-forgot-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required />
                                        {forgotError && <p className="admin-error" role="alert">{forgotError}</p>}
                                        <button type="submit" disabled={forgotSubmitting}>{forgotSubmitting ? t.signingIn : t.continueLabel}<span>→</span></button>
                                    </form>
                                    <button type="button" className="admin-forgot-link" onClick={closeForgotPassword}>{t.backToSignIn}</button>
                                </>
                            )}

                            {forgotStep === "forgot_email_code" && (
                                <>
                                    <p className="admin-label">Verification</p>
                                    <h2>We sent a code to your registered email.</h2>
                                    <form onSubmit={handleRecoveryEmailCodeSubmit}>
                                        <label htmlFor="admin-recovery-email-code">Code</label>
                                        <input id="admin-recovery-email-code" value={recoveryEmailCode} onChange={(event) => setRecoveryEmailCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" required />
                                        {forgotNotice && <p className="admin-message" role="status">{forgotNotice}</p>}
                                        {forgotError && <p className="admin-error" role="alert">{forgotError}</p>}
                                        <button type="submit" disabled={forgotSubmitting}>{forgotSubmitting ? "Verifying..." : "Verify"}<span>→</span></button>
                                    </form>
                                    <button type="button" className="admin-forgot-link" onClick={closeForgotPassword}>{t.backToSignIn}</button>
                                </>
                            )}

                            {forgotStep === "forgot_totp" && (
                                <>
                                    <p className="admin-label">Authenticator verification</p>
                                    <h2>Enter the 6-digit code from Google Authenticator.</h2>
                                    <form onSubmit={handleRecoveryTotpSubmit}>
                                        <label htmlFor="admin-recovery-totp-code">Code</label>
                                        <input id="admin-recovery-totp-code" value={recoveryTotpCode} onChange={(event) => setRecoveryTotpCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" required />
                                        {forgotError && <p className="admin-error" role="alert">{forgotError}</p>}
                                        <button type="submit" disabled={forgotSubmitting}>{forgotSubmitting ? "Verifying..." : "Verify"}<span>→</span></button>
                                    </form>
                                    <button type="button" className="admin-forgot-link" onClick={closeForgotPassword}>{t.backToSignIn}</button>
                                </>
                            )}

                            {forgotStep === "forgot_new_password" && (
                                <>
                                    <p className="admin-label">{t.forgotPassword}</p>
                                    <h2>Create new password</h2>
                                    <form onSubmit={handleRecoveryResetSubmit}>
                                        <label htmlFor="admin-recovery-new-password">New password</label>
                                        <div className="admin-password-field">
                                            <input id="admin-recovery-new-password" type={recoveryShowNewPassword ? "text" : "password"} value={recoveryNewPassword} onChange={(event) => setRecoveryNewPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required />
                                            <button type="button" className="admin-password-toggle" aria-label={recoveryShowNewPassword ? t.hidePassword : t.showPassword} onClick={() => setRecoveryShowNewPassword((current) => !current)}>
                                                {recoveryShowNewPassword ? <EyeOffIcon /> : <EyeIcon />}
                                            </button>
                                        </div>
                                        <label htmlFor="admin-recovery-confirm-password">Confirm new password</label>
                                        <div className="admin-password-field">
                                            <input id="admin-recovery-confirm-password" type={recoveryShowConfirmPassword ? "text" : "password"} value={recoveryConfirmPassword} onChange={(event) => setRecoveryConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required />
                                            <button type="button" className="admin-password-toggle" aria-label={recoveryShowConfirmPassword ? t.hidePassword : t.showPassword} onClick={() => setRecoveryShowConfirmPassword((current) => !current)}>
                                                {recoveryShowConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                                            </button>
                                        </div>
                                        {forgotError && <p className="admin-error" role="alert">{forgotError}</p>}
                                        <button type="submit" disabled={forgotSubmitting}>{forgotSubmitting ? "Changing..." : "Change password"}<span>→</span></button>
                                    </form>
                                    <button type="button" className="admin-forgot-link" onClick={closeForgotPassword}>{t.backToSignIn}</button>
                                </>
                            )}

                            {forgotStep === "forgot_success" && (
                                <>
                                    <p className="admin-label">{t.forgotPassword}</p>
                                    <h2>Password changed successfully.</h2>
                                    <button type="button" onClick={closeForgotPassword}>{t.backToSignIn}<span>→</span></button>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <p className="admin-label">{t.welcomeBack}</p>
                            <h2>{t.signInTitle}<br />{t.yourWorkspace}</h2>
                            <form onSubmit={handleSubmit}>
                                <label htmlFor="admin-username">{t.username}</label>
                                <input id="admin-username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required />
                                <label htmlFor="admin-password">{t.password}</label>
                                <div className="admin-password-field">
                                    <input id="admin-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
                                    <button type="button" className="admin-password-toggle" aria-label={showPassword ? t.hidePassword : t.showPassword} onClick={() => setShowPassword((current) => !current)}>
                                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                                {error && <p className="admin-error" role="alert">{error}</p>}
                                <button type="submit" disabled={submitting}>{submitting ? t.signingIn : t.enterWorkspace}<span>→</span></button>
                            </form>
                            <button type="button" className="admin-forgot-link" onClick={openForgotPassword}>{t.forgotPassword}</button>
                        </>
                    )}
                </div>
            </section>
        </main>
    );
}

export default AdminPage;
