import { useEffect, useState } from "react";

import {
    addWhitelistEntry,
    getAdminSession,
    getAdminSettings,
    getWhitelist,
    loginAdmin,
    removeWhitelistEntry,
    saveBillingConfig,
    saveCameraConfig,
    saveGarageSettings,
} from "../services/api";
import "../styles/AdminPage.css";

const TOKEN_KEY = "parking_admin_token";
const LANGUAGE_KEY = "parking_admin_language";
const THEME_KEY = "parking_admin_theme";

const TRANSLATIONS = {
    en: {
        language: "اردو", theme: "Dark mode", lightTheme: "Light mode", signOut: "Sign out",
        controlCenter: "Control center", whitelist: "Whitelist", garageSettings: "Garage Settings", cameraSetup: "Camera Setup", billing: "Billing",
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
        adminAccess: "Garage administration", makeEvery: "Make every", spaceCount: "space count.", loginIntro: "A clear, quiet view of the operation behind your parking floor.", secureAccess: "Secure admin access", signInTitle: "Sign in to", yourWorkspace: "your workspace.", username: "Username", password: "Password", signingIn: "Signing in...", enterWorkspace: "Enter workspace", returnGarage: "← Return to garage view",
        required: "This field is required.", zero: "This field cannot be zero.", positiveNumber: "Please enter a valid positive number.", maxLevels: "Maximum 12 levels allowed.", cameraRange: "Please enter a value between 1 and 4.", fixErrors: "Please fix the errors before applying.", fixCameraErrors: "Please fix the camera lane errors before saving.", vehicleAdded: "Vehicle added to the whitelist.", vehicleRemoved: "Vehicle removed from the whitelist.", garageApplied: "Garage layout applied successfully.", camerasSaved: "Camera allocation saved successfully.", billingApplied: "Billing settings applied successfully.", loginFailed: "Unable to sign in. Please check your credentials.", requestFailed: "Unable to complete that request. Please try again.", checkingSession: "Checking session...", examplePlate: "e.g. ABC-123", exampleManager: "e.g. Manager",
    },
    ur: {
        language: "English", theme: "ڈارک موڈ", lightTheme: "لائٹ موڈ", signOut: "سائن آؤٹ",
        controlCenter: "کنٹرول سینٹر", whitelist: "اجازت یافتہ فہرست", garageSettings: "گیراج سیٹنگز", cameraSetup: "کیمرہ سیٹ اپ", billing: "بلنگ",
        vehicleTitle: "گاڑی", whitelistTitle: "اجازت یافتہ فہرست۔", vehicleIntro: "معتبر گاڑیوں کو چیک آؤٹ پر خصوصی رعایت دیں۔",
        addVehicle: "گاڑی شامل کریں", numberPlate: "نمبر پلیٹ", name: "نام", discountPercentage: "رعایت کا فیصد", addToWhitelist: "فہرست میں شامل کریں",
        removeVehicle: "گاڑی ہٹائیں", nameOrPlate: "نام یا نمبر پلیٹ", searchList: "فہرست میں تلاش کریں", removeHint: "مختص نام یا درست نمبر پلیٹ درج کریں۔", removeFromList: "فہرست سے ہٹائیں",
        hideList: "فہرست چھپائیں", showList: "فہرست دکھائیں", discount: "رعایت", added: "شامل کرنے کی تاریخ",
        garageTitle: "گیراج", layoutTitle: "لے آؤٹ۔", garageIntro: "اپنے پارکنگ گیراج کی ساخت مرتب کریں، پھر ہر منزل کا نام اور جگہوں کی تعداد تبدیل کریں۔",
        levels: "منزلیں", spacesPerLevel: "ہر منزل کی جگہیں", advancedEditor: "اعلیٰ فلور ایڈیٹر", advancedHint: "ہر منزل کا نام بدلیں اور اس کی درست جگہوں کی تعداد مقرر کریں۔", levelName: "منزل کا نام", spaces: "جگہیں", apply: "لاگو کریں", advanced: "ایڈوانسڈ",
        confirmLayout: "گیراج لے آؤٹ کی تصدیق", cancel: "منسوخ کریں", confirm: "تصدیق کریں",
        cameraTitle: "انٹری اور ایگزٹ", cameraSetupTitle: "کیمرہ سیٹ اپ۔", cameraIntro: "ہر لین کے لیے کیمروں کی تعداد مقرر کریں۔ ہر لین میں 1 تا 4 کیمرے ہونے چاہئیں۔", entryCameras: "انٹری لین کیمرے", exitCameras: "ایگزٹ لین کیمرے", saveCameras: "کیمروں کو محفوظ کریں",
        paymentTitle: "ادائیگی", paymentSettings: "سیٹنگز۔", paymentIntro: "اپنے پارکنگ گیراج کے لیے ادائیگی کے اختیارات فعال یا غیر فعال کریں۔", enablePayments: "ادائیگی کے اختیارات فعال کریں", acceptedPayments: "قبول شدہ ادائیگی کے طریقے منتخب کریں:", cash: "نقد", card: "کارڈ",
        workspace: "ایڈمن ورک اسپیس", welcomeBack: "خوش آمدید،", online: "سسٹم آن لائن ہے", workspaceIntro: "اپنے گیراج کا انتظام کرنے کے لیے سائڈبار سے ایک فیچر منتخب کریں۔",
        adminAccess: "گیراج انتظامیہ", makeEvery: "ہر", spaceCount: "جگہ اہم بنائیں۔", loginIntro: "آپ کی پارکنگ منزل کے آپریشن کا واضح اور پُرسکون منظر۔", secureAccess: "محفوظ ایڈمن رسائی", signInTitle: "اپنی ورک اسپیس میں", yourWorkspace: "سائن ان کریں۔", username: "صارف نام", password: "پاس ورڈ", signingIn: "سائن ان ہو رہا ہے...", enterWorkspace: "ورک اسپیس میں داخل ہوں", returnGarage: "گیراج ویو پر واپس جائیں →",
        required: "یہ فیلڈ ضروری ہے۔", zero: "یہ فیلڈ صفر نہیں ہو سکتی۔", positiveNumber: "براہ کرم درست مثبت نمبر درج کریں۔", maxLevels: "زیادہ سے زیادہ 12 منزلیں اجازت یافتہ ہیں۔", cameraRange: "براہ کرم 1 سے 4 کے درمیان قدر درج کریں۔", fixErrors: "لاگو کرنے سے پہلے غلطیاں درست کریں۔", fixCameraErrors: "محفوظ کرنے سے پہلے کیمرہ لین کی غلطیاں درست کریں۔", vehicleAdded: "گاڑی اجازت یافتہ فہرست میں شامل کر دی گئی ہے۔", vehicleRemoved: "گاڑی اجازت یافتہ فہرست سے ہٹا دی گئی ہے۔", garageApplied: "گیراج لے آؤٹ کامیابی سے لاگو ہو گیا ہے۔", camerasSaved: "کیمرہ تقسیم کامیابی سے محفوظ ہو گئی ہے۔", billingApplied: "بلنگ سیٹنگز کامیابی سے لاگو ہو گئی ہیں۔", loginFailed: "سائن ان نہیں ہو سکا۔ براہ کرم اپنی معلومات چیک کریں۔", requestFailed: "درخواست مکمل نہیں ہو سکی۔ براہ کرم دوبارہ کوشش کریں۔", checkingSession: "سیشن کی جانچ ہو رہی ہے...", examplePlate: "مثلاً ABC-123", exampleManager: "مثلاً منیجر",
    },
};

function DisplayControls({ t, theme, language, onLanguageChange, onThemeToggle }) {
    return (
        <div className="admin-display-controls">
            <select className="language-select" value={language} onChange={(event) => onLanguageChange(event.target.value)} aria-label="Select language">
                <option value="en">English</option>
                <option value="ur">اردو</option>
            </select>
            <button type="button" className="theme-toggle" onClick={onThemeToggle}><span aria-hidden="true">{theme === "light" ? "◐" : "☀"}</span>{theme === "light" ? t.theme : t.lightTheme}</button>
        </div>
    );
}

function AdminPage() {
    const [language, setLanguage] = useState(() => localStorage.getItem(LANGUAGE_KEY) === "ur" ? "ur" : "en");
    const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light");
    const t = TRANSLATIONS[language];
    const isUrdu = language === "ur";
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [adminName, setAdminName] = useState("");
    const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
    const [loading, setLoading] = useState(Boolean(token));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [activeFeature, setActiveFeature] = useState(null);
    const [plate, setPlate] = useState("");
    const [vehicleName, setVehicleName] = useState("");
    const [discount, setDiscount] = useState("");
    const [removeSearch, setRemoveSearch] = useState("");
    const [whitelist, setWhitelist] = useState([]);
    const [whitelistVisible, setWhitelistVisible] = useState(false);
    const [whitelistLoading, setWhitelistLoading] = useState(false);
    const [whitelistError, setWhitelistError] = useState("");
    const [whitelistMessage, setWhitelistMessage] = useState("");
    const [garageSettings, setGarageSettings] = useState({ level_count: "", levels: [], spaces_per_level: "" });
    const [garageSettingsMessage, setGarageSettingsMessage] = useState("");
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
    const [advancedGarageSettings, setAdvancedGarageSettings] = useState(false);
    const [confirmationOpen, setConfirmationOpen] = useState(false);
    const [billingConfig, setBillingConfig] = useState({ payments_enabled: false, cash_enabled: false, card_enabled: false });
    const [billingMessage, setBillingMessage] = useState("");

    useEffect(() => {
        localStorage.setItem(LANGUAGE_KEY, language);
    }, [language]);

    useEffect(() => {
        localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    useEffect(() => {
        if (!token) return;
        getAdminSession(token)
            .then((session) => setAdminName(session.username))
            .catch(() => {
                sessionStorage.removeItem(TOKEN_KEY);
                setToken(null);
            })
            .finally(() => setLoading(false));

        getAdminSettings(token)
            .then((settings) => {
                const garage = settings.garage_settings;
                if (garage?.level_count > 0) {
                    setGarageSettings({
                        level_count: String(garage.level_count),
                        spaces_per_level: String(garage.spaces_per_level),
                        levels: (garage.levels || []).map((level) => ({
                            ...level,
                            spaces: String(level.spaces),
                        })),
                    });
                }
                if (settings.camera_config) {
                    setCameraConfig({
                        entry_lane_cameras: String(settings.camera_config.entry_lane_cameras),
                        exit_lane_cameras: String(settings.camera_config.exit_lane_cameras),
                    });
                }
                if (settings.billing_config) {
                    setBillingConfig(settings.billing_config);
                }
            })
            .catch(() => {});
    }, [token]);

    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError("");
        try {
            const result = await loginAdmin(username, password);
            sessionStorage.setItem(TOKEN_KEY, result.access_token);
            setToken(result.access_token);
            setAdminName(username.trim());
            setPassword("");
        } catch {
            setError(t.loginFailed);
        } finally {
            setSubmitting(false);
        }
    }

    function signOut() {
        sessionStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setAdminName("");
    }

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
            setWhitelistMessage(t.vehicleRemoved);
        } catch {
            setWhitelistError(t.requestFailed);
        } finally {
            setWhitelistLoading(false);
        }
    }

    async function showWhitelist() {
        if (whitelistVisible) {
            setWhitelistVisible(false);
            return;
        }

        setWhitelistLoading(true);
        setWhitelistError("");
        try {
            const result = await getWhitelist(token);
            setWhitelist(result.entries || []);
            setWhitelistVisible(true);
        } catch {
            setWhitelistError(t.requestFailed);
        } finally {
            setWhitelistLoading(false);
        }
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

    function handleCameraConfigChange(field, value) {
        const nextValue = value.replace(/[^\d]/g, "");
        setCameraConfig((current) => ({
            ...current,
            [field]: nextValue,
        }));

        const errorMessage = validateCameraField(field, nextValue);
        setCameraErrors((current) => ({
            ...current,
            [field]: nextValue === "" ? t.required : errorMessage,
        }));

        if (nextValue === "0") {
            setCameraErrors((current) => ({
                ...current,
                [field]: t.cameraRange,
            }));
        }

        if (errorMessage === "") {
            setCameraMessage("");
        }
    }

    async function handleCameraConfigSubmit(event) {
        event.preventDefault();
        const nextErrors = {
            entry_lane_cameras: validateCameraField("entry_lane_cameras", cameraConfig.entry_lane_cameras),
            exit_lane_cameras: validateCameraField("exit_lane_cameras", cameraConfig.exit_lane_cameras),
        };

        setCameraErrors(nextErrors);

        const hasError = Object.values(nextErrors).some((message) => Boolean(message));
        if (hasError) {
            setCameraMessageType("warning");
            setCameraMessage(t.fixCameraErrors);
            return;
        }

        try {
            await saveCameraConfig(token, {
                entry_lane_cameras: Number(cameraConfig.entry_lane_cameras),
                exit_lane_cameras: Number(cameraConfig.exit_lane_cameras),
            });
            setCameraMessageType("success");
            setCameraMessage(t.camerasSaved);
        } catch {
            setCameraMessageType("warning");
            setCameraMessage(t.requestFailed);
        }
    }

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

    async function handleBillingApply(event) {
        event.preventDefault();
        try {
            await saveBillingConfig(token, billingConfig);
            setBillingMessage(t.billingApplied);
            setTimeout(() => setBillingMessage(""), 3000);
        } catch {
            setBillingMessage(t.requestFailed);
        }
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

        if (field === "levels" && numericValue > 12) {
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

            const numericCount = Math.min(12, Math.max(1, Number(cleanedValue) || 1));
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

    function handleGarageSettingsApply(event) {
        event.preventDefault();
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

        setGarageSettingsMessageType("success");
        setGarageSettingsMessage("");
        setConfirmationOpen(true);
    }

    async function confirmGarageSettings() {
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

        try {
            await saveGarageSettings(token, {
                level_count: count,
                spaces_per_level: defaultSpaces,
                levels: payloadLevels,
            });
            setGarageSettings((current) => ({
                ...current,
                level_count: String(count),
                spaces_per_level: String(defaultSpaces),
                levels: payloadLevels.map((l) => ({ ...l, spaces: String(l.spaces) })),
            }));
            setGarageSettingsMessageType("success");
            setGarageSettingsMessage(t.garageApplied);
            setConfirmationOpen(false);
        } catch (err) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage(err?.message || t.requestFailed);
            setConfirmationOpen(false);
        }
    }

    if (loading) return <main className={`admin-shell admin-theme-${theme} admin-loading`} dir={isUrdu ? "rtl" : "ltr"} lang={language}>{t.checkingSession}</main>;

    if (token) {
        return (
            <main className={`admin-shell admin-theme-${theme}`} dir={isUrdu ? "rtl" : "ltr"} lang={language}>
                <header className="admin-header">
                    <a href="/" className="admin-logo">PARKING<span>OS</span></a>
                    <div className="admin-header-actions"><DisplayControls t={t} theme={theme} language={language} onLanguageChange={setLanguage} onThemeToggle={() => setTheme((current) => current === "light" ? "dark" : "light")} /><div className="admin-user">{adminName}<button type="button" onClick={signOut}>{t.signOut}</button></div></div>
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
                    </aside>
                    <section className="admin-dashboard">
                        {activeFeature === "whitelist" ? (
                            <div className="feature-view">
                                <h1>{t.vehicleTitle}<br /><span>{t.whitelistTitle}</span></h1>
                                <p className="admin-message">{t.vehicleIntro}</p>
                                <div className="whitelist-actions">
                                    <form className="whitelist-card" onSubmit={submitWhitelist}><div className="card-heading"><span>01</span><h2>{t.addVehicle}</h2></div><label htmlFor="plate">{t.numberPlate}</label><input id="plate" value={plate} onChange={(event) => setPlate(event.target.value)} placeholder={t.examplePlate} required /><label htmlFor="vehicle-name">{t.name}</label><input id="vehicle-name" value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} placeholder={t.exampleManager} required /><label htmlFor="discount">{t.discountPercentage}</label><input id="discount" type="number" min="0" max="100" step="1" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="0 - 100" required /><button type="submit" disabled={whitelistLoading}>{t.addToWhitelist} <span>→</span></button></form>
                                    <form className="whitelist-card remove-card" onSubmit={submitRemove}><div className="card-heading"><span>02</span><h2>{t.removeVehicle}</h2></div><label htmlFor="remove-search">{t.nameOrPlate}</label><input id="remove-search" value={removeSearch} onChange={(event) => setRemoveSearch(event.target.value)} placeholder={t.searchList} required /><p className="form-hint">{t.removeHint}</p><button type="submit" disabled={whitelistLoading}>{t.removeFromList} <span>→</span></button></form>
                                </div>
                                {whitelistError && <p className="admin-error whitelist-feedback">{whitelistError}</p>}
                                {whitelistMessage && <p className="whitelist-success">{whitelistMessage}</p>}
                                <button type="button" className="show-list-button" onClick={showWhitelist} disabled={whitelistLoading}>{whitelistVisible ? t.hideList : t.showList} <span>{whitelistLoading ? "..." : whitelistVisible ? "↑" : "↓"}</span></button>
                                {whitelistVisible && whitelist.length > 0 && <div className="whitelist-table-wrap"><table><thead><tr><th>{t.name}</th><th>{t.numberPlate}</th><th>{t.discount}</th><th>{t.added}</th></tr></thead><tbody>{whitelist.map((entry) => <tr key={entry.id}><td>{entry.vehicle_name}</td><td>{entry.license_plate}</td><td>{entry.discount_percent}%</td><td>{entry.created_at ? new Date(entry.created_at).toLocaleDateString(language === "ur" ? "ur-PK" : "en-PK", { timeZone: "Asia/Karachi" }) : "-"}</td></tr>)}</tbody></table></div>}
                            </div>
                        ) : activeFeature === "garage-settings" ? (
                            <div className="feature-view">
                                <h1>{t.garageTitle}<br /><span>{t.layoutTitle}</span></h1>
                                <p className="admin-message">{t.garageIntro}</p>

                                <form className="garage-settings-form" onSubmit={handleGarageSettingsApply}>
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

                                    {garageSettingsMessage && (
                                        <p className={garageSettingsMessageType === "warning" ? "admin-error whitelist-feedback" : "whitelist-success"}>{garageSettingsMessage}</p>
                                    )}

                                    <div className="settings-actions">
                                        <button type="submit" className="settings-save-button">{t.apply} <span>→</span></button>
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

                                {confirmationOpen && (
                                    <div className="confirmation-overlay" onClick={() => setConfirmationOpen(false)}>
                                        <div className="confirmation-dialog" onClick={(event) => event.stopPropagation()}>
                                            <h3>{t.confirmLayout}</h3>
                                            <p><strong>{t.levels}:</strong> {garageSettings.level_count || garageSettings.levels?.length || 0}</p>
                                            <p><strong>{t.spacesPerLevel}:</strong> {garageSettings.spaces_per_level || 0}</p>
                                            <div className="confirmation-actions">
                                                <button type="button" className="confirmation-cancel" onClick={() => setConfirmationOpen(false)}>{t.cancel}</button>
                                                <button type="button" className="confirmation-confirm" onClick={confirmGarageSettings}>{t.confirm}</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : activeFeature === "camera-config" ? (
                            <div className="feature-view">
                                <h1>{t.cameraTitle}<br /><span>{t.cameraSetupTitle}</span></h1>
                                <p className="admin-message">{t.cameraIntro}</p>

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
                                        <p className={cameraMessageType === "warning" ? "admin-error whitelist-feedback" : "whitelist-success"}>{cameraMessage}</p>
                                    )}

                                    <div className="settings-actions">
                                        <button type="submit" className="settings-save-button">{t.saveCameras} <span>→</span></button>
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
                                    )}

                                    {billingMessage && <p className="whitelist-success">{billingMessage}</p>}

                                    <div className="settings-actions">
                                        <button type="submit" className="settings-save-button">{t.apply} <span>→</span></button>
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
                </div>
            </main>
        );
    }

    return (
        <main className={`admin-shell admin-theme-${theme} admin-login-shell`} dir={isUrdu ? "rtl" : "ltr"} lang={language}>
            <section className="admin-welcome">
                <div className="admin-login-top"><a href="/" className="admin-logo">PARKING<span>OS</span></a><DisplayControls t={t} theme={theme} language={language} onLanguageChange={setLanguage} onThemeToggle={() => setTheme((current) => current === "light" ? "dark" : "light")} /></div>
                <div><p className="admin-label">{t.adminAccess}</p><h1>{t.makeEvery}<br /><span>{t.spaceCount}</span></h1><p className="admin-subtitle">{t.loginIntro}</p></div>
                <small>{t.secureAccess}</small>
            </section>
            <section className="admin-form-panel">
                <div className="admin-form-wrap">
                    <p className="admin-label">{t.welcomeBack}</p>
                    <h2>{t.signInTitle}<br />{t.yourWorkspace}</h2>
                    <form onSubmit={handleSubmit}>
                        <label htmlFor="admin-username">{t.username}</label>
                        <input id="admin-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
                        <label htmlFor="admin-password">{t.password}</label>
                        <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
                        {error && <p className="admin-error" role="alert">{error}</p>}
                        <button type="submit" disabled={submitting}>{submitting ? t.signingIn : t.enterWorkspace}<span>→</span></button>
                    </form>
                    <a className="admin-return" href="/">{t.returnGarage}</a>
                </div>
            </section>
        </main>
    );
}

export default AdminPage;
