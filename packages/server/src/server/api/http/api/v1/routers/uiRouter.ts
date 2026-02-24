import fs from "fs";
import { Next } from "koa";
import { RouterContext } from "koa-router";
import { HTML } from "../responses/success";
import { Server } from "@server";
import { isEmpty } from "@server/helpers/utils";
import { GeneralInterface } from "@server/api/interfaces/generalInterface";

export class UiRouter {
    static async index(ctx: RouterContext, _: Next) {
        const landingPath = Server().repo.getConfig('landing_page_path') as string;
        if (!isEmpty(landingPath)) {
            // See if the file path exists
            // if it doesn't, return a warning
            // if it does, return the file
            if (fs.existsSync(landingPath)) {
                return new HTML(ctx, fs.readFileSync(landingPath, 'utf8')).send();
            }

            return new HTML(
                ctx,
                `
                    <html>
                        <title>BlueBubbles Server</title>
                        <body>
                            <h4>[WARNING] Custom landing page not found!</h4>
                        </body>
                    </html>
                `
            ).send();
        }

        const meta = await GeneralInterface.getServerMetadata();
        const customEnv = Server().repo.getConfig('custom_environment') as string;
        const env = (customEnv && customEnv.trim().length > 0) ? customEnv.trim() : (process.env.NODE_ENV ?? "unknown");
        const now = new Date().toUTCString();

        const row = (label: string, value: string, highlight = false) => `
            <tr>
                <td class="label">${label}</td>
                <td class="value ${highlight ? "highlight" : ""}">${value}</td>
            </tr>`;

        return new HTML(
            ctx,
            `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>BlueBubbles Server</title>
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                        background: #0f1117;
                        color: #e2e8f0;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 2rem;
                    }
                    .card {
                        background: #1a1d27;
                        border: 1px solid #2d3148;
                        border-radius: 12px;
                        padding: 2rem 2.5rem;
                        max-width: 640px;
                        width: 100%;
                    }
                    .header {
                        display: flex;
                        align-items: center;
                        gap: 0.75rem;
                        margin-bottom: 1.75rem;
                        border-bottom: 1px solid #2d3148;
                        padding-bottom: 1.25rem;
                    }
                    .dot {
                        width: 10px; height: 10px;
                        border-radius: 50%;
                        background: #22c55e;
                        box-shadow: 0 0 6px #22c55e;
                    }
                    h1 { font-size: 1.25rem; font-weight: 600; color: #f8fafc; }
                    .subtitle { font-size: 0.8rem; color: #64748b; margin-top: 0.2rem; }
                    table { width: 100%; border-collapse: collapse; }
                    tr + tr td { border-top: 1px solid #1e2235; }
                    td { padding: 0.6rem 0.25rem; font-size: 0.875rem; vertical-align: top; }
                    .label { color: #64748b; width: 44%; white-space: nowrap; }
                    .value { color: #cbd5e1; word-break: break-all; }
                    .highlight { color: #a78bfa; font-weight: 500; }
                    .section-gap td { padding-top: 1.25rem; }
                    .section-label { font-size: 0.7rem; text-transform: uppercase;
                        letter-spacing: 0.1em; color: #475569; padding-top: 1.25rem !important; }
                    .footer { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #2d3148;
                        font-size: 0.75rem; color: #475569; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="header">
                        <div class="dot"></div>
                        <div>
                            <h1>BlueBubbles Server</h1>
                            <div class="subtitle">Running &mdash; ${now}</div>
                        </div>
                    </div>
                    <table>
                        <tr><td class="section-label" colspan="2">Build</td></tr>
                        ${row("Server Version", `v${meta.server_version}`, true)}
                        ${row("Environment", env)}
                        ${row("macOS Version", meta.os_version)}
                        ${row("Computer ID", meta.computer_id)}

                        <tr><td class="section-label" colspan="2">Connectivity</td></tr>
                        ${row("Proxy Service", meta.proxy_service || "—")}

                        <tr><td class="section-label" colspan="2">Integrations</td></tr>
                        ${row("Private API", meta.private_api ? "Enabled" : "Disabled")}
                        ${row("Helper Connected", meta.helper_connected ? "Yes" : "No")}
                        ${row("iCloud Account", meta.detected_icloud || "—")}
                        ${row("iMessage Account", meta.detected_imessage || "—")}
                        ${row("macOS Time Sync", meta.macos_time_sync != null ? `${meta.macos_time_sync}ms` : "—")}
                    </table>
                    <div class="footer">
                        Connect a BlueBubbles client to this server using the address and password configured in the app.
                    </div>
                </div>
            </body>
            </html>`
        ).send();
    }
}
