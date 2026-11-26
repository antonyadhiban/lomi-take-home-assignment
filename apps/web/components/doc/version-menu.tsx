"use client";

import { ChevronDown, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { VersionStatus } from "@/lib/types";

export function VersionMenu({
  versions,
  current,
  viewing,
  onView,
  onUploadNew,
}: {
  versions: { version: number; status: VersionStatus }[];
  current: number;
  viewing: number;
  onView: (v: number) => void;
  onUploadNew: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 font-mono text-xs">
          v{viewing}
          <span className="hidden text-muted-foreground sm:inline">{viewing === current ? "· current" : "· history"}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <div className="flex items-center justify-between">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Versions</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onUploadNew} className="gap-1.5 text-xs"><Upload /> Upload</DropdownMenuItem>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={String(viewing)} onValueChange={(x) => onView(Number(x))}>
          {[...versions].reverse().map((x) => (
            <DropdownMenuRadioItem key={x.version} value={String(x.version)} className="font-mono text-xs">
              v{x.version}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
