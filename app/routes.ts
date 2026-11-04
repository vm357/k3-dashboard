import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sign-in", "routes/auth/sign-in.tsx"),
  route("sign-out", "routes/auth/sign-out.tsx"),
  route("forgot", "routes/auth/forgot.tsx"),
  route("invite/:token", "routes/auth/invite.tsx"),
  route("no-business", "routes/auth/no-business.tsx"),

  ...prefix("app", [
    index("routes/app/choose.tsx"),
    layout("routes/app/business-layout.tsx", [
      ...prefix(":business", [
        index("routes/app/today.tsx"),
        route("calendar", "routes/app/calendar.tsx"),
        route("book", "routes/app/book.tsx"),
        route("waitlist/new", "routes/app/waitlist-new.tsx"),
        route("appointments/:appointmentId", "routes/app/appointment.tsx"),
        route("clients", "routes/app/clients.tsx"),
        route("clients/duplicates", "routes/app/duplicates.tsx"),
        route("reports", "routes/app/reports.tsx"),
        route("settings", "routes/app/settings.tsx"),
        route("services", "routes/app/services.tsx", [route(":serviceId", "routes/app/service-edit.tsx")]),
        route("team", "routes/app/team.tsx"),
        route("team/:employeeId", "routes/app/employee.tsx"),
        route("clients/new", "routes/app/client-new.tsx"),
        route("clients/:customerId", "routes/app/client.tsx"),
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
