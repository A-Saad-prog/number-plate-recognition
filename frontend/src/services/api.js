const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ||
    "http://127.0.0.1:8000";
const VISION_DEBUG = import.meta.env.DEV && import.meta.env.VITE_VISION_DEBUG === "true";

function garageAuthHeaders() {
    const token = localStorage.getItem("parking_admin_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function requestError(response, data, fallback) {
    const error = new Error(data.detail || data.error || fallback);
    error.status = response.status;
    return error;
}


// ============================================================
// Get Available Parking Space
// ============================================================

export async function getAvailableSpace() {

    const response = await fetch(
        `${API_BASE_URL}/parking/available-space`
    );

    if (!response.ok) {

        throw new Error(
            `Failed to get available parking space: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Get Latest Detected License Plate
// ============================================================

export async function getDetectedPlate() {

    const response = await fetch(
        `${API_BASE_URL}/parking/detected-plate`
    );

    if (!response.ok) {

        throw new Error(
            `Failed to get detected plate: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Get Parking Spaces
// ============================================================

export async function getParkingSpaces() {

    const response = await fetch(
        `${API_BASE_URL}/parking/spaces`, { headers: garageAuthHeaders() }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {

        throw requestError(response, data, `Failed to get parking spaces: ${response.status}`);

    }

    return data;
}


export async function getGarageSettings() {

    const response = await fetch(
        `${API_BASE_URL}/garage/settings`, { headers: garageAuthHeaders() }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {

        throw requestError(response, data, `Failed to get garage settings: ${response.status}`);

    }

    return data;
}


// ============================================================
// Detect Plate from Camera Frame
// ============================================================

export async function detectPlateFromFrame(imageDataUrl, source, requestId) {
    const requestStartedAt = performance.now();

    const response = await fetch(
        `${API_BASE_URL}/vision/detect-plate`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                image: imageDataUrl,
                source,
                request_id: requestId || undefined,
            }),
        }
    );

    const parseStartedAt = performance.now();
    const data = await response.json().catch(() => ({}));
    const parseMs = performance.now() - parseStartedAt;
    const apiTotalMs = performance.now() - requestStartedAt;

    if (VISION_DEBUG) {
        console.debug(
            `[Vision FE API] id=${requestId || "n/a"} source=${source || "default"} api=${apiTotalMs.toFixed(1)}ms parse=${parseMs.toFixed(1)}ms`
        );
    }

    if (!response.ok) {

        throw new Error(
            data.detail || `Failed to detect plate: ${response.status}`
        );

    }

    return data;
}


// ============================================================
// Register Vehicle Entry
// ============================================================

export async function registerEntry(licensePlate, parkingSpaceId) {

    const response = await fetch(
        `${API_BASE_URL}/parking/entry`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                ...garageAuthHeaders(),
            },

            body: JSON.stringify({
                license_plate: licensePlate,
                parking_space_id: parkingSpaceId,
            }),
        }
    );

    if (!response.ok) {

        throw new Error(
            `Failed to register vehicle entry: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Exit Using License Plate
// ============================================================

export async function getExitPaymentRequired(licensePlate) {
    const response = await fetch(
        `${API_BASE_URL}/parking/exit/payment-required?license_plate=${encodeURIComponent(licensePlate)}`,
        { headers: garageAuthHeaders() }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.detail || `Failed to check exit payment: ${response.status}`);
    }
    return data;
}

export async function exitUsingPlate(licensePlate, paymentMethod) {

    const response = await fetch(
        `${API_BASE_URL}/parking/exit`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                ...garageAuthHeaders(),
            },

            body: JSON.stringify({
                license_plate: licensePlate,
                payment_method: paymentMethod,
            }),
        }
    );

    if (!response.ok) {

        throw new Error(
            `Failed to process vehicle exit: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Exit Using QR Code
// ============================================================

export async function exitUsingQR(qrCode) {

    const response = await fetch(
        `${API_BASE_URL}/parking/exit/qr`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                qr_code: qrCode,
            }),
        }
    );

    if (!response.ok) {

        throw new Error(
            `Failed to process QR exit: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Admin Authentication and Whitelist Management
// ============================================================

export async function loginAdmin(username, password) {
    const response = await fetch(`${API_BASE_URL}/admin/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Login failed: ${response.status}`);
    }

    return data;
}

export async function getAdminSession(token) {
    const response = await fetch(`${API_BASE_URL}/admin/me`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(data.detail || `Failed to get admin session: ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return data;
}

export async function getWhitelist(token) {
    const response = await fetch(`${API_BASE_URL}/admin/whitelist`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to get whitelist: ${response.status}`);
    }

    return data;
}

export async function addWhitelistEntry(token, entry) {
    const response = await fetch(`${API_BASE_URL}/admin/whitelist`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(entry),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to add whitelist entry: ${response.status}`);
    }

    return data;
}

export async function removeWhitelistEntry(token, search) {
    const response = await fetch(`${API_BASE_URL}/admin/whitelist`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ search }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to remove whitelist entry: ${response.status}`);
    }

    return data;
}

async function adminSettingsRequest(token, path, method = "GET", body) {
    const response = await fetch(`${API_BASE_URL}/admin/settings${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        let message = `Unable to save admin settings: ${response.status}`;
        if (typeof data.detail === "string") {
            message = data.detail;
        } else if (Array.isArray(data.detail) && data.detail.length > 0) {
            message = data.detail.map((e) => e.msg || e.detail || JSON.stringify(e)).join("; ");
        } else if (data.message) {
            message = data.message;
        }
        throw new Error(message);
    }
    return data;
}

export function getAdminSettings(token) {
    return adminSettingsRequest(token, "");
}

export function saveGarageSettings(token, settings) {
    return adminSettingsRequest(token, "/garage", "PUT", settings);
}

export function saveCameraConfig(token, config) {
    return adminSettingsRequest(token, "/cameras", "PUT", config);
}

export function saveBillingConfig(token, config) {
    return adminSettingsRequest(token, "/billing", "PUT", config);
}

export async function getParkingActivity(token) {
    const response = await fetch(`${API_BASE_URL}/admin/activity`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Failed to load parking activity: ${response.status}`);
    return data;
}
