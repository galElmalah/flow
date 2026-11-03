import { providerFailureFields } from "../../shared/provider-errors.mjs";
export const jsonRequest = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: response.status,
      ...providerFailureFields(data),
    });
  return data;
};
export const download = (data, name) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};
export const cls = (...xs) => xs.filter(Boolean).join(" ");
