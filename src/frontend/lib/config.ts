export type NavItem = {
  href: string;
  label: string;
  external?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export type SiteConfig = {
  name: string;
  description: string;
  url: string;
  author: {
    name: string;
    url: string;
  };
  links: {
    github: string;
  };
  /** Primary top-level links shown directly in the navbar. */
  navItems: NavItem[];
  /** Grouped destinations rendered as dropdown menus (desktop) / sections (mobile). */
  navGroups: NavGroup[];
};

export const siteConfig: SiteConfig = {
  name: "core-ai-tools",
  description:
    "Session-based AI image & video editing platform — a non-destructive revision tree, driven over REST, MCP, and the browser, live over WebSocket.",
  url: "https://core-ai-tools.hacolby.workers.dev",
  author: {
    name: "126colby",
    url: "https://github.com/jmbish04",
  },
  links: {
    github: "https://github.com/jmbish04/core-ai-tools",
  },
  // Primary destinations for the image-editing product.
  navItems: [
    { href: "/library", label: "Library" },
    { href: "/sessions", label: "Sessions" },
    { href: "/models", label: "Models" },
    { href: "/prompts", label: "Prompts" },
  ],
  navGroups: [
    {
      label: "Workspace",
      items: [
        { href: "/", label: "Home" },
        { href: "/chat", label: "Assistant Chat" },
        { href: "/dashboard", label: "Analytics Dashboard" },
        { href: "/inbox", label: "Inbox" },
      ],
    },
    {
      label: "Developer",
      items: [
        { href: "/mcp-setup", label: "MCP Setup" },
        { href: "/openapi.json", label: "OpenAPI" },
        { href: "/scalar", label: "Scalar" },
        { href: "/swagger", label: "Swagger" },
        { href: "/docs", label: "Docs" },
      ],
    },
    {
      label: "System",
      items: [
        { href: "/notifications", label: "Notifications" },
        { href: "/settings", label: "Settings" },
        { href: "/showcase/utilities", label: "Utilities" },
      ],
    },
  ],
};
