"use client";

/**
 * 数据服务的地址。全站唯一一份，别再各页复制。
 *
 * 两种运行形态：
 *   · 开发时：前端跑在 3000（Next dev），后端在 18080，需要跨端口指过去。
 *     判据只看端口不看主机名——平板用局域网 IP 访问时 hostname 是 IP 而不是
 *     localhost，如果按主机名判，API 会打到 3000 的 Next dev server 上全部 404。
 *   · 部署后：静态前端由数据服务同源托管，直接用当前 host 即可。
 *
 * 需要指到别的机器时用 NEXT_PUBLIC_API_BASE_URL 覆盖。
 */
const DEV_FRONTEND_PORT = "3000";
const API_PORT = "18080";

export const resolveHttpBase = () => {
  if (typeof window === "undefined") {
    return "";
  }
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  const { protocol, hostname, port } = window.location;
  if (port === DEV_FRONTEND_PORT) {
    return `${protocol}//${hostname}:${API_PORT}`;
  }
  return `${protocol}//${window.location.host}`;
};

/** WebSocket 地址，跟着 HTTP 地址走 */
export const resolveWsBase = () => {
  const http = resolveHttpBase();
  if (!http) {
    return "";
  }
  return http.replace(/^http/, "ws");
};
