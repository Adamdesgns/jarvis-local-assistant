import type { Metadata } from "next";
import { JarvisDemo } from "./JarvisDemo";

export const metadata: Metadata = {
  title: "JARVIS — Interactive Demo",
  description:
    "Step inside JARVIS: a free, private, local-first AI assistant for Windows.",
};

export default function Home() {
  return <JarvisDemo />;
}
