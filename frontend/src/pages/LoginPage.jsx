import { useEffect, useState } from "react";
import {
    loginAdmin,
    verifyAdminLoginTotp,
    verifyAdminLoginRecoveryCode,
    requestPasswordRecovery,
    verifyRecoveryEmail,
    resetAdminPassword,
} from "../services/api";
import "../styles/LoginPage.css";

const TOKEN_KEY = "parking_admin_token";
const LANGUAGE_KEY = "parking_admin_language";
const THEME_KEY = "parking_admin_theme";

const TRANSLATIONS = {
    en: {
        language: "اردو",
        theme: "Dark mode",
        lightTheme: "Light mode",
        adminAccess: "Garage administration",
        makeEvery: "Make every",
        spaceCount: "space count.",
        loginIntro: "A clear, quiet view of the operation behind your parking floor.",
        secureAccess: "Secure admin access",
        welcomeBack: "Welcome back,",
        signInTitle: "Sign in to",
        yourWorkspace: "your workspace.",
        username: "Username or Email",
        password: "Password",
        signingIn: "Signing in...",
        enterWorkspace: "Enter workspace",
        showPassword: "Show password",
        hidePassword: "Hide password",
        forgotPassword: "Forgot password?",
        forgotPasswordTitle: "Forgot password",
        forgotPasswordHint: "Enter your Username or Email",
        continueLabel: "Continue",
        backToSignIn: "← Back to sign in",
        loginFailed: "Unable to sign in. Please check your credentials.",
        requestFailed: "Unable to complete that request. Please try again.",
    },
    ur: {
        language: "English",
        theme: "ڈارک موڈ",
        lightTheme: "لائٹ موڈ",
        adminAccess: "گیراج ایڈمنسٹریشن",
        makeEvery: "ہر",
        spaceCount: "سپیس اہم بنائیں۔",
        loginIntro: "آپ کے پارکنگ فلور کے آپریشن کا ایک کلیئر، کوائٹ ویو۔",
        secureAccess: "سیکیور ایڈمن ایکسیس",
        welcomeBack: "ویلکم بیک،",
        signInTitle: "اپنی ورک اسپیس میں",
        yourWorkspace: "سائن ان کریں۔",
        username: "یوزر نیم یا ای میل",
        password: "پاس ورڈ",
        signingIn: "سائن ان ہو رہا ہے...",
        enterWorkspace: "ورک اسپیس اینٹر کریں",
        showPassword: "پاس ورڈ شو کریں",
        hidePassword: "پاس ورڈ ہائیڈ کریں",
        forgotPassword: "پاس ورڈ بھول گئے؟",
        forgotPasswordTitle: "پاس ورڈ بھول گئے",
        forgotPasswordHint: "اپنا یوزر نیم یا ای میل درج کریں",
        continueLabel: "کنٹینیو کریں",
        backToSignIn: "← سائن ان پر بیک جائیں",
        loginFailed: "سائن ان نہیں ہو سکا۔ براہ کرم اپنی کریڈینشلز چیک کریں۔",
        requestFailed: "وہ ریکویسٹ کمپلیٹ نہیں ہو سکی۔ براہ کرم دوبارہ ٹرائی کریں۔",
    },
};

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

function LoginPage({ redirectTo = "/" }) {
    const [language, setLanguage] = useState(() => localStorage.getItem(LANGUAGE_KEY) === "ur" ? "ur" : "en");
    const [theme, setTheme] = useState(() => ["system", "light", "dark"].includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : "light");
    const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false);
    const appliedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
    const t = TRANSLATIONS[language];
    const isUrdu = language === "ur";
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [twoFactorChallenge, setTwoFactorChallenge] = useState("");
    const [twoFactorMode, setTwoFactorMode] = useState("totp");
    const [twoFactorCode, setTwoFactorCode] = useState("");
    const [twoFactorSubmitting, setTwoFactorSubmitting] = useState(false);
    const [twoFactorError, setTwoFactorError] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
    const [forgotNotice, setForgotNotice] = useState("");

    // Forgot-password state machine: forgot_identifier -> forgot_email_code
    // -> forgot_new_password -> forgot_success.
    const [forgotStep, setForgotStep] = useState("forgot_identifier");
    const [forgotError, setForgotError] = useState("");
    const [forgotSubmitting, setForgotSubmitting] = useState(false);
    const [recoveryChallengeToken, setRecoveryChallengeToken] = useState("");
    const [recoveryEmailCode, setRecoveryEmailCode] = useState("");
    const [recoveryResetToken, setRecoveryResetToken] = useState("");
    const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
    const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
    const [recoveryShowNewPassword, setRecoveryShowNewPassword] = useState(false);
    const [recoveryShowConfirmPassword, setRecoveryShowConfirmPassword] = useState(false);

    useEffect(() => {
        localStorage.setItem(LANGUAGE_KEY, language);
    }, [language]);

    useEffect(() => {
        localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    useEffect(() => {
        const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
        if (!mediaQuery) return;
        const updateSystemTheme = (event) => setSystemDark(event.matches);
        mediaQuery.addEventListener?.("change", updateSystemTheme);
        return () => mediaQuery.removeEventListener?.("change", updateSystemTheme);
    }, []);

    useEffect(() => {
        if (localStorage.getItem(TOKEN_KEY)) {
            window.location.replace(redirectTo);
        }
    }, [redirectTo]);

    function continueToRequestedPage(accessToken) {
        localStorage.setItem(TOKEN_KEY, accessToken);
        sessionStorage.removeItem(TOKEN_KEY);
        window.location.replace(redirectTo);
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError("");
        try {
            const result = await loginAdmin(identifier, password);
            if (result.requires_2fa) {
                setTwoFactorChallenge(result.challenge_token || "");
                setTwoFactorMode("totp");
                setTwoFactorCode("");
                setTwoFactorError("");
                setPassword("");
                return;
            }
            continueToRequestedPage(result.access_token);
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
            const result = await verifyRecoveryEmail(recoveryChallengeToken, recoveryEmailCode.trim());
            setForgotNotice("");
            setRecoveryEmailCode("");
            setRecoveryResetToken(result.reset_token || "");
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
            setRecoveryChallengeToken("");
            setRecoveryEmailCode("");
            setRecoveryResetToken("");
            setRecoveryNewPassword("");
            setRecoveryConfirmPassword("");
            closeForgotPassword();
        } catch (error) {
            setForgotError(error.message || "Unable to reset password.");
        } finally {
            setForgotSubmitting(false);
        }
    }

    async function handleTwoFactorSubmit(event) {
        event.preventDefault();
        const code = twoFactorCode.trim();
        const validLength = twoFactorMode === "totp" ? /^\d{6}$/.test(code) : code.length >= 8;
        if (!validLength) {
            setTwoFactorError("Enter a valid authentication code.");
            return;
        }
        setTwoFactorSubmitting(true);
        setTwoFactorError("");
        try {
            const result = twoFactorMode === "totp"
                ? await verifyAdminLoginTotp(twoFactorChallenge, code)
                : await verifyAdminLoginRecoveryCode(twoFactorChallenge, code);
            continueToRequestedPage(result.access_token);
        } catch (error) {
            if (error.status === 410) {
                backToPasswordLogin();
                setError("Your authentication challenge expired. Please sign in again.");
            } else {
                setTwoFactorError("Invalid or expired authentication challenge.");
            }
        } finally {
            setTwoFactorSubmitting(false);
        }
    }

    function backToPasswordLogin() {
        setTwoFactorChallenge("");
        setTwoFactorCode("");
        setTwoFactorError("");
        setTwoFactorMode("totp");
    }

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    return (
        <main className={`login-page login-shell login-theme-${appliedTheme}`} dir={isUrdu ? "rtl" : "ltr"} lang={language}>
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
                            {forgotStep === "forgot_new_password" && (
                                <>
                                    <p className="admin-label">{t.forgotPassword}</p>
                                    <h2>Create new password</h2>
                                    <form onSubmit={handleRecoveryResetSubmit}>
                                        <label htmlFor="admin-recovery-new-password">New password</label>
                                        <div className="admin-password-field">
                                            <input id="admin-recovery-new-password" type={recoveryShowNewPassword ? "text" : "password"} value={recoveryNewPassword} onChange={(event) => setRecoveryNewPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required />
                                            <button type="button" className="admin-password-toggle" aria-label={recoveryShowNewPassword ? t.hidePassword : t.showPassword} onClick={() => setRecoveryShowNewPassword((current) => !current)}>{recoveryShowNewPassword ? <EyeOffIcon /> : <EyeIcon />}</button>
                                        </div>
                                        <label htmlFor="admin-recovery-confirm-password">Confirm new password</label>
                                        <div className="admin-password-field">
                                            <input id="admin-recovery-confirm-password" type={recoveryShowConfirmPassword ? "text" : "password"} value={recoveryConfirmPassword} onChange={(event) => setRecoveryConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required />
                                            <button type="button" className="admin-password-toggle" aria-label={recoveryShowConfirmPassword ? t.hidePassword : t.showPassword} onClick={() => setRecoveryShowConfirmPassword((current) => !current)}>{recoveryShowConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}</button>
                                        </div>
                                        {forgotError && <p className="admin-error" role="alert">{forgotError}</p>}
                                        <button type="submit" disabled={forgotSubmitting}>{forgotSubmitting ? "Changing..." : "Change password"}<span>→</span></button>
                                    </form>
                                    <button type="button" className="admin-forgot-link" onClick={closeForgotPassword}>{t.backToSignIn}</button>
                                </>
                            )}
                        </>
                    ) : twoFactorChallenge ? (
                        <>
                            <p className="admin-label">Security</p>
                            <h2>Two-factor authentication</h2>
                            <p>Enter the 6-digit code from your authenticator app.</p>
                            <form onSubmit={handleTwoFactorSubmit}>
                                <label htmlFor="admin-two-factor-code">{twoFactorMode === "totp" ? "Authentication code" : "Recovery code"}</label>
                                <input id="admin-two-factor-code" value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} autoComplete="one-time-code" inputMode={twoFactorMode === "totp" ? "numeric" : "text"} maxLength={twoFactorMode === "totp" ? 6 : 14} autoFocus required />
                                {twoFactorError && <p className="admin-error" role="alert">{twoFactorError}</p>}
                                <button type="submit" disabled={twoFactorSubmitting}>{twoFactorSubmitting ? "Verifying..." : "Verify"}<span>→</span></button>
                            </form>
                            {twoFactorMode === "totp" && <button type="button" className="admin-forgot-link" onClick={() => { setTwoFactorMode("recovery"); setTwoFactorCode(""); setTwoFactorError(""); }}>Use a recovery code</button>}
                            {twoFactorMode === "recovery" && <button type="button" className="admin-forgot-link" onClick={() => { setTwoFactorMode("totp"); setTwoFactorCode(""); setTwoFactorError(""); }}>Use authenticator code</button>}
                            <button type="button" className="admin-forgot-link" onClick={backToPasswordLogin}>Back to login</button>
                        </>
                    ) : (
                        <>
                            <p className="admin-label">{t.welcomeBack || "Welcome back,"}</p>
                            <h2>{t.signInTitle}<br />{t.yourWorkspace}</h2>
                            <form onSubmit={handleSubmit}>
                                <label htmlFor="admin-username">{t.username}</label>
                                <input id="admin-username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required />
                                <label htmlFor="admin-password">{t.password}</label>
                                <div className="admin-password-field">
                                    <input id="admin-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
                                    <button type="button" className="admin-password-toggle" aria-label={showPassword ? t.hidePassword : t.showPassword} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOffIcon /> : <EyeIcon />}</button>
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

export default LoginPage;
