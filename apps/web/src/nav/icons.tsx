import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      {children}
    </svg>
  );
}

export const Icons = {
  home: (p: IconProps) => (
    <Svg {...p}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></Svg>
  ),
  create: (p: IconProps) => (
    <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
  ),
  assets: (p: IconProps) => (
    <Svg {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Svg>
  ),
  audience: (p: IconProps) => (
    <Svg {...p}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.2" /><path d="M4 19c.6-3.2 2.8-5 5-5s4.4 1.8 5 5M14 19c.3-1.8 1.5-3 3-3s2.6 1 3 3" /></Svg>
  ),
  commerce: (p: IconProps) => (
    <Svg {...p}><path d="M6 7h15l-1.4 8.2A2 2 0 0 1 17.6 17H9.2a2 2 0 0 1-2-1.7L6 7Zm0 0L5 4H3" /><circle cx="10" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></Svg>
  ),
  space: (p: IconProps) => (
    <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.4 2.4 3.6 5 3.6 8S14.4 17.6 12 20C9.6 17.6 8.4 15 8.4 12S9.6 6.4 12 4Z" /></Svg>
  ),
  messages: (p: IconProps) => (
    <Svg {...p}><path d="M5 6h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" /></Svg>
  ),
  analytics: (p: IconProps) => (
    <Svg {...p}><path d="M5 19V9M12 19V5M19 19v-7" /></Svg>
  ),
  money: (p: IconProps) => (
    <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 7v10M9.5 9.5c.6-1 1.6-1.5 2.5-1.5 1.6 0 2.6 1 2.6 2.2 0 3-5.2 1.5-5.2 4.3 0 1.3 1.1 2.3 2.6 2.3.9 0 1.8-.5 2.4-1.4" /></Svg>
  ),
  distribute: (p: IconProps) => (
    <Svg {...p}><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 12h8M16.2 7.5 8.8 11M16.2 16.5 8.8 13" /></Svg>
  ),
  ai: (p: IconProps) => (
    <Svg {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6.2 6.2l2 2M15.8 15.8l2 2M17.8 6.2l-2 2M8.2 15.8l-2 2" /><circle cx="12" cy="12" r="3.2" /></Svg>
  ),
  settings: (p: IconProps) => (
    <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2M6.4 6.4l1.4 1.4M16.2 16.2l1.4 1.4M17.6 6.4 16.2 7.8M7.8 16.2 6.4 17.6" /></Svg>
  ),
  projects: (p: IconProps) => (
    <Svg {...p}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 5V4h8v1M8 10h8M8 14h5" /></Svg>
  ),
  brand: (p: IconProps) => (
    <Svg {...p}><path d="M12 3 19 7.5v9L12 21 5 16.5v-9L12 3Z" /><path d="M12 12 19 7.5M12 12v9M12 12 5 7.5" /></Svg>
  ),
  activity: (p: IconProps) => (
    <Svg {...p}><path d="M4 13h3l2.5-6 3 10 2.5-5H20" /></Svg>
  ),
  live: (p: IconProps) => (
    <Svg {...p}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /></Svg>
  ),
  production: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="6" width="8" height="12" rx="1.5" />
      <rect x="13" y="6" width="8" height="12" rx="1.5" />
    </Svg>
  ),
  recording: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </Svg>
  ),
};

export type IconName = keyof typeof Icons;
