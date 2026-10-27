import { CHANNEL_COLORS, channelLabel, isChannel } from "@/lib/contacts/taxonomy";
import { cn } from "@/lib/utils";

/** El canal de un toque (Orgánico, Pauta, Referido, Directo) como una pastilla de color. Sin canal conocido, no se dibuja. */
export function ChannelChip({ channel, className }: { channel: string | null | undefined; className?: string }) {
  if (!isChannel(channel)) return null;
  return <span className={cn("inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", CHANNEL_COLORS[channel], className)}>{channelLabel(channel)}</span>;
}
