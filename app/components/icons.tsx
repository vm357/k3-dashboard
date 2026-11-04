import type { ComponentProps } from "react";

/** Line icons, 2px stroke, round caps, matching the system's Lucide temperature. Decorative by default. */
function Icon({ children, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconToday = (p: ComponentProps<"svg">) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const IconCalendar = (p: ComponentProps<"svg">) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);
export const IconClients = (p: ComponentProps<"svg">) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7" />
  </Icon>
);
export const IconSettings = (p: ComponentProps<"svg">) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  </Icon>
);
export const IconPlus = (p: ComponentProps<"svg">) => (
  <Icon strokeWidth="2.25" {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const IconBack = (p: ComponentProps<"svg">) => (
  <Icon strokeWidth="2.25" {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);
export const IconCheck = (p: ComponentProps<"svg">) => (
  <Icon strokeWidth="2.5" {...p}>
    <path d="M5 12l5 5L20 7" />
  </Icon>
);
export const IconReports = (p: ComponentProps<"svg">) => (
	<Icon {...p}>
		<path d="M4 19h16M7 16V9M12 16V5M17 16v-6" />
	</Icon>
);
export const IconClose = (p: ComponentProps<"svg">) => (
	<Icon strokeWidth="2.25" {...p}>
		<path d="M18 6L6 18M6 6l12 12" />
	</Icon>
);
export const IconNoShow = (p: ComponentProps<"svg">) => (
	<Icon strokeWidth="2.25" {...p}>
		<circle cx="9" cy="7" r="4" />
		<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M17 8l5 5M22 8l-5 5" />
	</Icon>
);
export const IconMove = (p: ComponentProps<"svg">) => (
	<Icon strokeWidth="2.25" {...p}>
		<rect x="3" y="4" width="18" height="18" rx="2" />
		<path d="M16 2v4M8 2v4M3 10h18M10 16h6M14 14l2 2-2 2" />
	</Icon>
);
export const IconCancel = (p: ComponentProps<"svg">) => (
	<Icon strokeWidth="2.25" {...p}>
		<circle cx="12" cy="12" r="10" />
		<path d="M15 9l-6 6M9 9l6 6" />
	</Icon>
);
