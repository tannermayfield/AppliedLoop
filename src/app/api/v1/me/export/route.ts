import { exportFileName, exportMyData } from "@/domain/identity/data-export";
import { apiRoute } from "@/lib/api";

// `GET /me/export`: the whole account as a JSON file download. The body is the export document
// itself (not wrapped in `{ data }`), because it is meant to be saved and opened on its own.
// `no-store`: a personal data export must never be kept by a cache or proxy.
export const GET = apiRoute(async ({ c }) => {
  const data = await exportMyData(c);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(data.exportedAt)}"`,
      "cache-control": "no-store",
    },
  });
});
