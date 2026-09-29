import { useEffect, useState } from "react";
import AdminPage from "./pages/AdminPage";
import GaragePage from "./pages/GaragePage";
import LoginPage from "./pages/LoginPage";

const TOKEN_KEY = "parking_admin_token";

function getLoginTarget(pathname) {
    return pathname === "/admin" ? "/admin" : pathname === "/garage" ? "/garage" : "/";
}

function App() {
    const { pathname, search } = window.location;
    const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
    const requestedPath = new URLSearchParams(search).get("next");
    const loginRedirectTo = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/";

    useEffect(() => {
        const syncSession = (event) => {
            if (event.key === TOKEN_KEY) setToken(event.newValue);
        };

        window.addEventListener("storage", syncSession);
        return () => window.removeEventListener("storage", syncSession);
    }, []);

    useEffect(() => {
        if (pathname === "/login" && token) {
            window.location.replace(loginRedirectTo);
        }
    }, [pathname, token, loginRedirectTo]);

    if (pathname === "/login") {
        if (token) return null;
        return <LoginPage redirectTo={loginRedirectTo} />;
    }

    const redirectTo = getLoginTarget(pathname);
    if (!token) return <LoginPage redirectTo={redirectTo} />;

    return pathname === "/admin" ? <AdminPage /> : <GaragePage />;
}

export default App;
