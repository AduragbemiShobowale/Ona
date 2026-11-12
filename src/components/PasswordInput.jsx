import { useState } from 'react'
import Icon from './icons'

// A password box with an eye button to show or hide what was typed.
export default function PasswordInput(props) {
  const [shown, setShown] = useState(false)
  return (
    <span className="pw">
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pw-toggle" onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} title={shown ? 'Hide password' : 'Show password'}>
        <Icon name={shown ? 'eyeOff' : 'eye'} size={19} />
      </button>
    </span>
  )
}
