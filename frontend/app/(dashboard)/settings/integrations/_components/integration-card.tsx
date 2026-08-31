import Image from "next/image";
import type { ReactNode } from "react";

export type Integration = {
  name: string;
  description: string;
  logo: string;
  url: string;
  /** Present only for integrations with a real OAuth flow wired up */
  provider?: "google_meet";
};

/**
 * One integration's card.
 *
 * `logo` is an image in /public/integrations; `icon` is anything else drawn in
 * the same square. The messaging channels have no logo file to point at, and
 * the alternative to this was a second card component that looked almost but
 * not quite the same on the same page.
 */
export function IntegrationCardShell({
  name,
  logo,
  icon,
  description,
  children,
}: {
  name: string;
  logo?: string;
  icon?: ReactNode;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-md border border-slate-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
      <div className="h-14 w-14 rounded-md border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0">
        {logo ? (
          <Image
            src={logo}
            alt={`${name} logo`}
            width={36}
            height={36}
            className="object-contain"
          />
        ) : (
          icon
        )}
      </div>

      <div className="flex-1">
        <p className="text-base font-semibold text-slate-900 dark:text-neutral-100">
          {name}
        </p>
        <p className="text-xs text-slate-400 dark:text-neutral-500 mt-1 leading-relaxed">
          {description}
        </p>
      </div>

      {children}
    </div>
  );
}

export const integrationConnectButtonClassName =
  "inline-flex h-9 w-full items-center justify-center rounded-md text-sm font-semibold text-white shadow-none border-none cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed";

export function IntegrationCard({ integration }: { integration: Integration }) {
  return (
    <IntegrationCardShell
      name={integration.name}
      logo={integration.logo}
      description={integration.description}
    >
      <a
        href={integration.url}
        target="_blank"
        rel="noopener noreferrer"
        className={integrationConnectButtonClassName}
        style={{ backgroundColor: "var(--theme-color)" }}
      >
        Connect
      </a>
    </IntegrationCardShell>
  );
}
