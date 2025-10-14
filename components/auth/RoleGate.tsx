"use client";

import { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

export function RoleGate({ allow, children }: { allow: ('admin'|'member'|'viewer')[]; children: ReactNode }) {
  const { role } = useAuth();
  if (!allow.includes(role)) {
    return (
      <div className="p-6 text-center text-zinc-500">
        권한이 부족합니다. 관리자에게 접근 권한을 요청하세요.
      </div>
    );
  }
  return <>{children}</>;
}
