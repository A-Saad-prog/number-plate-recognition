import { useEffect, useState } from "react";

import { getAdminSession, loginAdmin } from "../services/api";
import "./AdminPage.css";

const TOKEN_KEY = "parking_admin_token";

function AdminPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [adminName, setAdminName] = useState("");
    const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
    const [loading, setLoading] = useState(Boolean(token));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

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

    if (loading) return <main className="admin-shell admin-loading">Checking session...</main>;

    if (token) {
        return (
            <main className="admin-shell">
                <header className="admin-header">
                    <a href="/" className="admin-logo">PARKING<span>OS</span></a>
                    <div className="admin-user">{adminName}<button type="button" onClick={signOut}>Sign out</button></div>
                </header>
                <section className="admin-dashboard">
                    <p className="admin-label">Admin workspace</p>
                    <h1>Welcome back,<br /><span>{adminName}.</span></h1>
                    <div className="admin-status"><b /> System online</div>
                    <p className="admin-message">Your garage control center is ready. Management tools and reports will appear here next.</p>
                    <div className="admin-placeholder"><span>01</span><h2>Operations dashboard</h2><p>Coming soon</p></div>
                </section>
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
