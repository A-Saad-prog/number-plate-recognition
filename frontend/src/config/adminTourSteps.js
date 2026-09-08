// Step configuration for the Admin onboarding tour (see components/AdminTour.jsx).
// `feature` is the activeFeature value AdminPage must switch to before the
// target becomes available (null means the default dashboard/welcome view).
// `target` must match a stable `data-tour` attribute -- never a brittle
// positional selector like :nth-child.
export const ADMIN_TOUR_STEPS = [
    {
        id: "dashboard",
        target: '[data-tour="admin-dashboard"]',
        feature: null,
        placement: "bottom",
        title: "Your Admin Dashboard",
        description: "This is your workspace home. Every feature below lives in the sidebar on the left.",
    },
    {
        id: "whitelist",
        target: '[data-tour="whitelist-panel"]',
        feature: "whitelist",
        placement: "left",
        title: "Whitelist Management",
        description: "Add trusted vehicles here to grant automatic entry and custom discounts.",
    },
    {
        id: "garage-settings",
        target: '[data-tour="garage-settings-panel"]',
        feature: "garage-settings",
        placement: "left",
        title: "Garage Layout",
        description: "Configure your parking levels and spaces here. ParkingOS uses this structure for automatic space assignment.",
    },
    {
        id: "camera-config",
        target: '[data-tour="camera-config-panel"]',
        feature: "camera-config",
        placement: "left",
        title: "Camera Setup",
        description: "Allocate entry and exit lane cameras so ParkingOS can detect plates automatically.",
    },
    {
        id: "billing",
        target: '[data-tour="billing-panel"]',
        feature: "billing",
        placement: "left",
        title: "Billing & Payments",
        description: "Turn on payments, set your parking rate, and choose which payment methods to accept.",
    },
    {
        id: "parking-activity",
        target: '[data-tour="parking-activity-panel"]',
        feature: "parking-activity",
        placement: "left",
        title: "Parking Activity",
        description: "View live sessions, recent visits, and real-time space availability.",
    },
    {
        id: "analytics",
        target: '[data-tour="analytics-panel"]',
        feature: "analytics",
        placement: "left",
        title: "Analytics",
        description: "Track earnings, traffic trends, and rush-hour patterns over time.",
    },
    {
        id: "account-security",
        target: '[data-tour="account-menu"]',
        feature: null,
        placement: "bottom",
        title: "Account & Security",
        description: "Manage theme, language, and account security -- including email verification and two-factor login -- from here.",
    },
];
