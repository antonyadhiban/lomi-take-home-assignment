"use client";

import { Files, Moon, Sun } from "lucide-react";
import { LomiHome } from "./lomi-home";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function RailButton({ label, children, onClick, href, active }: { label: string; children: ReactNode; onClick?: () => void; href?: string; active?: boolean }) {
  const cls = cn(
    "flex size-9 items-center justify-center border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
    active && "border-border bg-accent text-foreground",
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className={cls} aria-label={label}>
            {children}
          </Link>
        ) : (
          <button type="button" className={cls} onClick={onClick} aria-label={label}>
            {children}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Midday-style chrome: a quiet icon rail on the left, content gets the rest. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-[60px] shrink-0 flex-col items-center gap-2 border-r bg-background py-4 md:flex">
        <LomiHome />
        <RailButton label="Documents" href="/" active={pathname === "/" || pathname.startsWith("/documents")}>
          <Files className="size-[18px]" />
        </RailButton>
        <div className="flex-1" />
        <RailButton label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          <Sun className="size-[18px] dark:hidden" />
          <Moon className="hidden size-[18px] dark:block" />
        </RailButton>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export function PageHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6", className)}>
      {children}
    </header>
  );
}
