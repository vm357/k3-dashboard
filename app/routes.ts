import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sign-in", "routes/auth/sign-in.tsx"),
  route("sign-out", "routes/auth/sign-out.tsx"),
  route("invite/:token", "routes/auth/invite.tsx"),
  route("no-business", "routes/auth/no-business.tsx"),

  ...prefix("app", [
    index("routes/app/choose.tsx"),
    layout("routes/app/business-layout.tsx", [
      ...prefix(":business", [
        index("routes/app/today.tsx"),
        route("calendar", "routes/app/calendar.tsx"),
        route("clients", "routes/app/clients.tsx"),
        route("settings", "routes/app/settings.tsx"),
        route("team", "routes/app/team.tsx"),
      ]),
    ]),
  ]),

  layout("routes/admin/layout.tsx", [
    ...prefix("admin", [
      index("routes/admin/businesses.tsx"),
      route("businesses/new", "routes/admin/new-business.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
