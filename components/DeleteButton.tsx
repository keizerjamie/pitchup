'use client'

interface Props {
  label: string
  confirmMessage: string
  action: () => Promise<void>
}

export default function DeleteButton({ label, confirmMessage, action }: Props) {
  return (
    <form
      action={async () => {
        if (confirm(confirmMessage)) await action()
      }}
    >
      <button
        type="submit"
        className="w-full py-3 rounded-xl font-semibold active:scale-95 transition-all text-sm"
        style={{ color: '#ef4444', border: '1px solid color-mix(in srgb, #ef4444 30%, transparent)', background: 'color-mix(in srgb, #ef4444 6%, transparent)' }}
      >
        {label}
      </button>
    </form>
  )
}
