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
                        <div className="sidebar-muted"><span>02</span><span>Operations</span><small>Coming soon</small></div>
                        <div className="sidebar-muted"><span>03</span><span>Reports</span><small>Coming soon</small></div>
                    </aside>
                    <section className="admin-dashboard">
                        {activeFeature !== "whitelist" ? (
                            <><p className="admin-label">Admin workspace</p><h1>Welcome back,<br /><span>{adminName}.</span></h1><div className="admin-status"><b /> System online</div><p className="admin-message">Select a feature from the sidebar to manage your garage.</p></>
                        ) : (
                            <div className="whitelist-view">
                                <p className="admin-label">Feature 01 / Access pricing</p>
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
