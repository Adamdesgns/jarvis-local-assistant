import type { Metadata } from "next";
import { JarvisJrDemo } from "./JarvisJrDemo";

export const metadata: Metadata = {
  title: "JARVIS JR — A private assistant built for kids",
  description: "Meet JARVIS JR: parent-controlled, age-aware, local-first, game-ready, and able to call Dad through a privately paired JARVIS PC.",
};

export default function JarvisJrPage() {
  return <JarvisJrDemo />;
}
