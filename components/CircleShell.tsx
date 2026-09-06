"use client";
import { usePrivy } from "@privy-io/react-auth";
import { CircleDashboard } from "./CircleDashboard";
import { InitializingScreen } from "./InitializingScreen";
import { LoginScreen } from "./LoginScreen";

export function CircleShell() {
  const { ready, authenticated } = usePrivy();
  if (!ready) return <InitializingScreen />;
  if (!authenticated) return <LoginScreen />;
  return <CircleDashboard />;
}