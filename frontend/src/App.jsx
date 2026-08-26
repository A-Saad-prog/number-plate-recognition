import AdminPage from "./pages/AdminPage";
import GaragePage from "./pages/GaragePage";

function App() {
    return window.location.pathname === "/admin"
        ? <AdminPage />
        : <GaragePage />;
}

export default App;
