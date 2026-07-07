import { Check, ChevronDown } from "lucide-react"

import { MODELS, getModel } from "@/lib/models"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ModelSelector({ value, onChange }) {
  const current = getModel(value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-foreground">
          {current.label}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {MODELS.map((m) => (
          <DropdownMenuItem
            key={m.value}
            onSelect={() => onChange(m.value)}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex flex-col">
              <span className="text-sm">{m.label}</span>
              <span className="text-xs text-muted-foreground">{m.description}</span>
            </div>
            {m.value === value && <Check className="size-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
