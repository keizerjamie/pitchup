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
        className="w-full py-3 rounded-xl font-semibold text-red-500 border border-red-100 hover:bg-red-50 active:scale-95 transition-all text-sm"
      >
        {label}
      </button>
    </form>
  )
}
