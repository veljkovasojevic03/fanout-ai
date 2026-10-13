import {
  AtSign,
  FileText,
  Image as ImageIcon,
  Mail,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";

import type { ContentType } from "@/lib/presets";

// Generic glyphs on purpose: no third-party brand logos in the product UI.
const ICONS: Record<ContentType, LucideIcon> = {
  blog: FileText,
  linkedin: AtSign,
  instagram: ImageIcon,
  email: Mail,
  x_thread: MessagesSquare,
};

export function ContentTypeIcon({ type, className }: { type: ContentType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon aria-hidden="true" className={className} />;
}
