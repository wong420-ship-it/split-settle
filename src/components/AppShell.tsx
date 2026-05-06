import { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[480px] min-h-screen bg-background px-5 pb-24 pt-6 shadow-sm sm:shadow-xl">
        {children}
      </div>
    </div>
  );
}
