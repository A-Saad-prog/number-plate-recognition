import { useEffect, useState } from "react";

import {
    addWhitelistEntry,
    getAdminSession,
    getWhitelist,
    loginAdmin,
    removeWhitelistEntry,
} from "../services/api";
import "../styles/AdminPage.css";

const TOKEN_KEY = "parking_admin_token";

function AdminPage() {
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
    const [garageSettings, setGarageSettings] = useState(() => {
        try {
            const saved = localStorage.getItem("garage_settings");
            return saved ? JSON.parse(saved) : {
                garage_name: "Parking OS",
                hourly_rate: 120,
                grace_period_minutes: 15,
                maintenance_mode: false,
                operating_hours: "24/7",
                levels: [],
                spaces_per_level: "",
            };
        } catch {
            return {
                garage_name: "Parking OS",
                hourly_rate: 120,
                grace_period_minutes: 15,
                maintenance_mode: false,
                operating_hours: "24/7",
                levels: [],
                spaces_per_level: "",
            };
        }
    });
    const [garageSettingsMessage, setGarageSettingsMessage] = useState("");
    const [garageSettingsMessageType, setGarageSettingsMessageType] = useState("success");
    const [garageErrors, setGarageErrors] = useState({
        levels: "",
        spaces_per_level: "",
    });
    const [cameraConfig, setCameraConfig] = useState(() => {
        try {
            const saved = localStorage.getItem("camera_config");
            return saved ? JSON.parse(saved) : {
                entry_lane_cameras: "",
                exit_lane_cameras: "",
            };
        } catch {
            return {
                entry_lane_cameras: "",
                exit_lane_cameras: "",
            };
        }
    });
    const [cameraErrors, setCameraErrors] = useState({
        entry_lane_cameras: "",
        exit_lane_cameras: "",
    });
    const [cameraMessage, setCameraMessage] = useState("");
    const [cameraMessageType, setCameraMessageType] = useState("success");
    const [advancedGarageSettings, setAdvancedGarageSettings] = useState(false);
    const [confirmationOpen, setConfirmationOpen] = useState(false);
    const [billingConfig, setBillingConfig] = useState(() => {
        try {
            const saved = localStorage.getItem("billing_config");
            return saved ? JSON.parse(saved) : {
                payments_enabled: false,
                cash_enabled: false,
                card_enabled: false,
            };
        } catch {
            return {
                payments_enabled: false,
                cash_enabled: false,
                card_enabled: false,
            };
        }
    });
    const [billingMessage, setBillingMessage] = useState("");

    useEffect(() => {
        if (!token) return;
        getAdminSession(token)
            .then((session) => setAdminName(session.username))
            .catch(() => {
                sessionStorage.removeItem(TOKEN_KEY);
                setToken(null);
            })
            .finally(() => setLoading(false));
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
        } catch (loginError) {
            setError(loginError.message);
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
            setWhitelistMessage("Vehicle added to the whitelist.");
        } catch (requestError) {
            setWhitelistError(requestError.message);
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
            setWhitelistMessage("Vehicle removed from the whitelist.");
        } catch (requestError) {
            setWhitelistError(requestError.message);
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
        } catch (requestError) {
            setWhitelistError(requestError.message);
        } finally {
            setWhitelistLoading(false);
        }
    }

    useEffect(() => {
        localStorage.setItem("garage_settings", JSON.stringify(garageSettings));
    }, [garageSettings]);

    useEffect(() => {
        localStorage.setItem("camera_config", JSON.stringify(cameraConfig));
    }, [cameraConfig]);

    useEffect(() => {
        localStorage.setItem("billing_config", JSON.stringify(billingConfig));
    }, [billingConfig]);

    function validateCameraField(field, value) {
        if (value === "") {
            return "This field is required.";
        }

        const numericValue = Number(value);
        if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 4) {
            return "Please enter a value between 1 and 4.";
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
            [field]: nextValue === "" ? "This field is required." : errorMessage,
        }));

        if (nextValue === "0") {
            setCameraErrors((current) => ({
                ...current,
                [field]: "Please enter a value between 1 and 4.",
            }));
        }

        if (errorMessage === "") {
            setCameraMessage("");
        }
    }

    function handleCameraConfigSubmit(event) {
        event.preventDefault();
        const nextErrors = {
            entry_lane_cameras: validateCameraField("entry_lane_cameras", cameraConfig.entry_lane_cameras),
            exit_lane_cameras: validateCameraField("exit_lane_cameras", cameraConfig.exit_lane_cameras),
        };

        setCameraErrors(nextErrors);

        const hasError = Object.values(nextErrors).some((message) => Boolean(message));
        if (hasError) {
            setCameraMessageType("warning");
            setCameraMessage("Please fix the camera lane errors before saving.");
            return;
        }

        setCameraMessageType("success");
        setCameraMessage("Camera allocation saved successfully.");
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

    function handleBillingApply(event) {
        event.preventDefault();
        setBillingMessage("Billing settings applied successfully.");
        setTimeout(() => setBillingMessage(""), 3000);
    }

    function handleGarageSettingChange(field, value) {
        setGarageSettings((current) => ({
            ...current,
            [field]: value,
        }));
    }

    function validateGarageField(field, value) {
        if (value === "") {
            return "This field is required.";
        }

        const numericValue = Number(value);
        if (numericValue === 0) {
            return "This field cannot be zero.";
        }

        if (!Number.isInteger(numericValue) || numericValue < 1) {
            return "Please enter a valid positive number.";
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

        setGarageSettings((current) => {
            if (!cleanedValue) {
                return {
                    ...current,
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
                    name: existingLevel?.name || `Level ${levelNumber}`,
                    spaces: resolvedSpaces,
                };
            });

            return {
                ...current,
                levels: nextLevels,
            };
        });
    }

    function applySpacesToAllLevels(nextSpacesValue) {
        const cleanedValue = nextSpacesValue.replace(/[^\d]/g, "");

        const errorMessage = validateGarageField("spaces_per_level", cleanedValue);
        setGarageErrors((current) => ({
            ...current,
            spaces_per_level: errorMessage,
        }));

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
        setGarageSettings((current) => ({
            ...current,
            levels: (current.levels || []).map((level, levelIndex) => {
                if (levelIndex !== index) return level;
                return {
                    ...level,
                    [field]: field === "spaces" ? (value === "" ? "" : Math.max(1, Number(value) || 1)) : value,
                };
            }),
        }));
    }

    function handleGarageSettingsApply(event) {
        event.preventDefault();
        const levelCount = garageSettings.levels?.length || 0;
        const spacesPerLevel = garageSettings.spaces_per_level;

        const nextErrors = {
            levels: validateGarageField("levels", levelCount ? String(levelCount) : ""),
            spaces_per_level: validateGarageField("spaces_per_level", spacesPerLevel),
        };

        setGarageErrors(nextErrors);

        const hasError = Object.values(nextErrors).some((message) => Boolean(message));
        if (hasError) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage("Please fix the errors before applying.");
            setConfirmationOpen(false);
            return;
        }

        setGarageSettingsMessageType("success");
        setGarageSettingsMessage("");
        setConfirmationOpen(true);
    }

    function confirmGarageSettings() {
        const levelCount = garageSettings.levels?.length || 0;
        const spacesPerLevel = garageSettings.spaces_per_level;

        if (!levelCount || !spacesPerLevel || Number(spacesPerLevel) <= 0) {
            setGarageSettingsMessageType("warning");
            setGarageSettingsMessage("Warning: enter a valid number of spaces per level before applying.");
            setConfirmationOpen(false);
            return;
        }

        setGarageSettingsMessageType("success");
        setGarageSettingsMessage("Garage layout applied successfully.");
        setConfirmationOpen(false);
    }

    if (loading) return <main className="admin-shell admin-loading">Checking session...</main>;

    if (token) {
        return (
            <main className="admin-shell">
                <header className="admin-header">
                    <a href="/" className="admin-logo">PARKING<span>OS</span></a>
                    <div className="admin-user">{adminName}<button type="button" onClick={signOut}>Sign out</button></div>
                </header>
                <div className="admin-app-body">
                    <aside className="admin-sidebar">
                        <p className="admin-label">Control center</p>
                        <button type="button" className={`sidebar-feature ${activeFeature === "whitelist" ? "active" : ""}`} onClick={() => { setActiveFeature(activeFeature === "whitelist" ? null : "whitelist"); setWhitelistError(""); }}>
                            <span className="feature-number">01</span><span>Whitelist</span><span className="feature-arrow">{activeFeature === "whitelist" ? "−" : "+"}</span>
                        </button>
                        <button type="button" className={`sidebar-feature ${activeFeature === "garage-settings" ? "active" : ""}`} onClick={() => setActiveFeature(activeFeature === "garage-settings" ? null : "garage-settings")}>
                            <span className="feature-number">02</span><span>Garage Settings</span><span className="feature-arrow">{activeFeature === "garage-settings" ? "−" : "+"}</span>
                        </button>
                        <button type="button" className={`sidebar-feature ${activeFeature === "camera-config" ? "active" : ""}`} onClick={() => setActiveFeature(activeFeature === "camera-config" ? null : "camera-config")}>
                            <span className="feature-number">03</span><span>Camera Setup</span><span className="feature-arrow">{activeFeature === "camera-config" ? "−" : "+"}</span>
                        </button>
                        <button type="button" className={`sidebar-feature ${activeFeature === "billing" ? "active" : ""}`} onClick={() => setActiveFeature(activeFeature === "billing" ? null : "billing")}>
                            <span className="feature-number">04</span><span>Billing</span><span className="feature-arrow">{activeFeature === "billing" ? "−" : "+"}</span>
                        </button>
                    </aside>
                    <section className="admin-dashboard">
                        {activeFeature === "whitelist" ? (
                            <div className="feature-view">
                                <h1>Vehicle<br /><span>whitelist.</span></h1>
                                <p className="admin-message">Give trusted vehicles a custom discount at checkout.</p>
                                <div className="whitelist-actions">
                                    <form className="whitelist-card" onSubmit={submitWhitelist}><div className="card-heading"><span>01</span><h2>Add vehicle</h2></div><label htmlFor="plate">Number plate</label><input id="plate" value={plate} onChange={(event) => setPlate(event.target.value)} placeholder="e.g. ABC-123" required /><label htmlFor="vehicle-name">Name</label><input id="vehicle-name" value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} placeholder="e.g. Manager" required /><label htmlFor="discount">Discount percentage</label><input id="discount" type="number" min="0" max="100" step="1" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="0 - 100" required /><button type="submit" disabled={whitelistLoading}>Add to whitelist <span>→</span></button></form>
                                    <form className="whitelist-card remove-card" onSubmit={submitRemove}><div className="card-heading"><span>02</span><h2>Remove vehicle</h2></div><label htmlFor="remove-search">Name or number plate</label><input id="remove-search" value={removeSearch} onChange={(event) => setRemoveSearch(event.target.value)} placeholder="Search the list" required /><p className="form-hint">Enter either the assigned name or the exact number plate.</p><button type="submit" disabled={whitelistLoading}>Remove from list <span>→</span></button></form>
                                </div>
                                {whitelistError && <p className="admin-error whitelist-feedback">{whitelistError}</p>}
                                {whitelistMessage && <p className="whitelist-success">{whitelistMessage}</p>}
                                <button type="button" className="show-list-button" onClick={showWhitelist} disabled={whitelistLoading}>{whitelistVisible ? "Hide list" : "Show list"} <span>{whitelistLoading ? "..." : whitelistVisible ? "↑" : "↓"}</span></button>
                                {whitelistVisible && whitelist.length > 0 && <div className="whitelist-table-wrap"><table><thead><tr><th>Name</th><th>Number plate</th><th>Discount</th><th>Added</th></tr></thead><tbody>{whitelist.map((entry) => <tr key={entry.id}><td>{entry.vehicle_name}</td><td>{entry.license_plate}</td><td>{entry.discount_percent}%</td><td>{entry.created_at ? new Date(entry.created_at).toLocaleDateString("en-PK", { timeZone: "Asia/Karachi" }) : "-"}</td></tr>)}</tbody></table></div>}
                            </div>
                        ) : activeFeature === "garage-settings" ? (
                            <div className="feature-view">
                                <h1>Garage<br /><span>layout.</span></h1>
                                <p className="admin-message">Set up the structure of your parking garage, then fine-tune each level with custom names and space counts.</p>

                                <form className="garage-settings-form" onSubmit={handleGarageSettingsApply}>
                                    <div className="level-config-block">
                                        <div className="level-config-header">
                                            <label className="level-count-field garage-field-group">
                                                <span>Levels</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    value={garageSettings.levels?.length ? String(garageSettings.levels.length) : ""}
                                                    onChange={(event) => updateLevelCount(event.target.value)}
                                                />
                                                <small className="admin-error whitelist-feedback error-space">
                                                    {garageErrors.levels || "\u00A0"}
                                                </small>
                                            </label>
                                            <label className="level-count-field garage-field-group">
                                                <span>Spaces per level</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    value={garageSettings.spaces_per_level}
                                                    onChange={(event) => {
                                                        const nextSpaces = event.target.value;
                                                        if (advancedGarageSettings) {
                                                            applySpacesToAllLevels(nextSpaces);
                                                            return;
                                                        }

                                                        const cleanedValue = nextSpaces.replace(/[^\d]/g, "");
                                                        const errorMessage = validateGarageField("spaces_per_level", cleanedValue);
                                                        setGarageErrors((current) => ({
                                                            ...current,
                                                            spaces_per_level: errorMessage,
                                                        }));
                                                        setGarageSettings((current) => ({
                                                            ...current,
                                                            spaces_per_level: cleanedValue,
                                                        }));
                                                    }}
                                                />
                                                <small className="admin-error whitelist-feedback error-space">
                                                    {garageErrors.spaces_per_level || "\u00A0"}
                                                </small>
                                            </label>
                                        </div>
                                    </div>

                                    {advancedGarageSettings && (
                                        <div className="advanced-level-editor">
                                            <h4>Advanced floor editor</h4>
                                            <p className="advanced-hint">Rename each floor and set the exact number of spaces for that level.</p>
                                            {(garageSettings.levels || []).map((level, index) => (
                                                <div key={level.id || index} className="advanced-level-row">
                                                    <label>
                                                        <span>Level name</span>
                                                        <input value={level.name} onChange={(event) => updateLevel(index, "name", event.target.value)} />
                                                    </label>
                                                    <label>
                                                        <span>Spaces</span>
                                                        <input type="text" inputMode="numeric" pattern="[0-9]*" value={level.spaces ?? ""} onChange={(event) => updateLevel(index, "spaces", event.target.value.replace(/[^\d]/g, ""))} />
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {garageSettingsMessage && (
                                        <p className={garageSettingsMessageType === "warning" ? "admin-error whitelist-feedback" : "whitelist-success"}>{garageSettingsMessage}</p>
                                    )}

                                    <div className="settings-actions">
                                        <button type="submit" className="settings-save-button">Apply <span>→</span></button>
                                        <button
                                            type="button"
                                            className="advanced-button"
                                            onClick={() => {
                                                setAdvancedGarageSettings((current) => {
                                                    const nextState = !current;

                                                    if (nextState) {
                                                        const nextSpaces = garageSettings.spaces_per_level || "";
                                                        applySpacesToAllLevels(nextSpaces);
                                                    }

                                                    return nextState;
                                                });
                                            }}
                                        >
                                            Advanced
                                        </button>
                                    </div>
                                </form>

                                {confirmationOpen && (
                                    <div className="confirmation-overlay" onClick={() => setConfirmationOpen(false)}>
                                        <div className="confirmation-dialog" onClick={(event) => event.stopPropagation()}>
                                            <h3>Confirm garage layout</h3>
                                            <p><strong>Levels:</strong> {garageSettings.levels?.length || 0}</p>
                                            <p><strong>Spaces per level:</strong> {garageSettings.spaces_per_level || 0}</p>
                                            <div className="confirmation-actions">
                                                <button type="button" className="confirmation-cancel" onClick={() => setConfirmationOpen(false)}>Cancel</button>
                                                <button type="button" className="confirmation-confirm" onClick={confirmGarageSettings}>Confirm</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : activeFeature === "camera-config" ? (
                            <div className="feature-view">
                                <h1>Entry & exit<br /><span>camera setup.</span></h1>
                                <p className="admin-message">Set the number of cameras for each lane. Each lane must have 1–4 cameras.</p>

                                <form className="garage-settings-form" onSubmit={handleCameraConfigSubmit}>
                                    <div className="level-config-block">
                                        <div className="level-config-header">
                                            <label className="level-count-field camera-field-group">
                                                <span>Entry lane cameras</span>
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
                                                <span>Exit lane cameras</span>
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
                                        <button type="submit" className="settings-save-button">Save cameras <span>→</span></button>
                                    </div>
                                </form>
                            </div>
                        ) : activeFeature === "billing" ? (
                            <div className="feature-view">
                                <h1>Payment<br /><span>settings.</span></h1>
                                <p className="admin-message">Enable or disable payment options for your parking garage.</p>

                                <form className="garage-settings-form" onSubmit={handleBillingApply}>
                                    <div className="billing-toggle-section">
                                        <label className="billing-toggle-label">
                                            <input type="checkbox" className="billing-checkbox" checked={billingConfig.payments_enabled} onChange={() => handleBillingToggle("payments_enabled")} />
                                            <span className="billing-toggle-text">Enable payment options</span>
                                        </label>
                                    </div>

                                    {billingConfig.payments_enabled && (
                                        <div className="billing-payment-methods">
                                            <p className="billing-subtitle">Select accepted payment methods:</p>
                                            <div className="payment-options">
                                                <label className="payment-option">
                                                    <input type="checkbox" className="payment-checkbox" checked={billingConfig.cash_enabled} onChange={() => handleBillingToggle("cash_enabled")} />
                                                    <span className="payment-method-name">💵 Cash</span>
                                                </label>
                                                <label className="payment-option">
                                                    <input type="checkbox" className="payment-checkbox" checked={billingConfig.card_enabled} onChange={() => handleBillingToggle("card_enabled")} />
                                                    <span className="payment-method-name">💳 Card</span>
                                                </label>
                                            </div>
                                        </div>
                                    )}

                                    {billingMessage && <p className="whitelist-success">{billingMessage}</p>}

                                    <div className="settings-actions">
                                        <button type="submit" className="settings-save-button">Apply <span>→</span></button>
                                    </div>
                                </form>
                            </div>
                        ) : (
                            <><p className="admin-label">Admin workspace</p><h1>Welcome back,<br /><span>{adminName}.</span></h1><div className="admin-status"><b /> System online</div><p className="admin-message">Select a feature from the sidebar to manage your garage.</p></>
                        )}
                    </section>
                </div>
            </main>
        );
    }

    return (
        <main className="admin-shell admin-login-shell">
            <section className="admin-welcome">
                <a href="/" className="admin-logo">PARKING<span>OS</span></a>
                <div><p className="admin-label">Garage administration</p><h1>Make every<br /><span>space count.</span></h1><p className="admin-subtitle">A clear, quiet view of the operation behind your parking floor.</p></div>
                <small>Secure admin access</small>
            </section>
            <section className="admin-form-panel">
                <div className="admin-form-wrap">
                    <p className="admin-label">Welcome back</p>
                    <h2>Sign in to<br />your workspace.</h2>
                    <form onSubmit={handleSubmit}>
                        <label htmlFor="admin-username">Username</label>
                        <input id="admin-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
                        <label htmlFor="admin-password">Password</label>
                        <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
                        {error && <p className="admin-error" role="alert">{error}</p>}
                        <button type="submit" disabled={submitting}>{submitting ? "Signing in..." : "Enter workspace"}<span>→</span></button>
                    </form>
                    <a className="admin-return" href="/">← Return to garage view</a>
                </div>
            </section>
        </main>
    );
}

export default AdminPage;
