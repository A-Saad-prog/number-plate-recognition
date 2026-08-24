const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ||
    "http://127.0.0.1:8000";

function formatErrorDetail(detail) {
    if (typeof detail === "string") {
        return detail;
    }

    if (Array.isArray(detail)) {
        return detail
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                return item.msg || JSON.stringify(item);
            })
            .join("; ");
    }

    if (detail && typeof detail === "object") {
        return detail.msg || JSON.stringify(detail);
    }

    return "";
}


// ============================================================
// Parking
// ============================================================

export async function getParkingSpaces() {

    const response = await fetch(
        `${API_BASE_URL}/parking/spaces`
    );

    if (!response.ok) {

        throw new Error(
            `Failed to get parking spaces: ${response.status}`
        );

    }

    return await response.json();
}


export async function registerEntry(
    licensePlate,
    parkingSpaceId
) {
    const requestStartedAt = performance.now();

    const body = {
        license_plate: licensePlate,
    };

    if (parkingSpaceId !== null && parkingSpaceId !== undefined) {
        body.parking_space_id = parkingSpaceId;
    }

    const response = await fetch(
        `${API_BASE_URL}/parking/entry`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify(body),
        }
    );

    const apiLatencyMs = performance.now() - requestStartedAt;
    console.log("[API latency]", {
        endpoint: "/parking/entry",
        status: response.status,
        durationMs: apiLatencyMs,
    });

    if (!response.ok) {

        const errorBody = await response.json().catch(() => ({}));
        const detail = formatErrorDetail(
            errorBody.detail || errorBody.error
        );

        throw new Error(
            detail
                ? `Failed to register vehicle entry: ${detail}`
                : `Failed to register vehicle entry: ${response.status}`
        );

    }

    return await response.json();
}


export async function exitUsingPlate(
    licensePlate,
    paymentMethod
) {
    const requestStartedAt = performance.now();

    const response = await fetch(
        `${API_BASE_URL}/parking/exit`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                license_plate: licensePlate,
                payment_method: paymentMethod,
            }),
        }
    );

    const apiLatencyMs = performance.now() - requestStartedAt;
    console.log("[API latency]", {
        endpoint: "/parking/exit",
        status: response.status,
        durationMs: apiLatencyMs,
    });

    if (!response.ok) {

        throw new Error(
            `Failed to process vehicle exit: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Vision
// ============================================================

export async function detectPlateFromFrame(image) {
    const requestStartedAt = performance.now();

    const response = await fetch(
        `${API_BASE_URL}/vision/detect-plate`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                image,
            }),
        }
    );

    const apiLatencyMs = performance.now() - requestStartedAt;
    console.log("[Vision API latency]", {
        endpoint: "/vision/detect-plate",
        status: response.status,
        durationMs: apiLatencyMs,
    });

    if (!response.ok) {

        throw new Error(
            `Vision API returned ${response.status}`
        );

    }

    return await response.json();
}


export async function loginAdmin(username, password) {
    const response = await fetch(
        `${API_BASE_URL}/admin/login`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ username, password }),
        }
    );

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(formatErrorDetail(body.detail) || "Invalid username or password.");
    }

    return body;
}


export async function getAdminSession(token) {
    const response = await fetch(
        `${API_BASE_URL}/admin/me`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
    );

    if (!response.ok) {
        throw new Error("Your admin session has expired.");
    }

    return await response.json();
}


async function adminRequest(path, token, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(formatErrorDetail(body.detail) || "Admin request failed.");
    }
    return body;
}


export function getWhitelist(token) {
    return adminRequest("/admin/whitelist", token);
}


export function addWhitelistEntry(token, entry) {
    return adminRequest("/admin/whitelist", token, {
        method: "POST",
        body: JSON.stringify(entry),
    });
}


export function removeWhitelistEntry(token, search) {
    return adminRequest("/admin/whitelist", token, {
        method: "DELETE",
        body: JSON.stringify({ search }),
    });
}