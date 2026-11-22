// The sign-in screen: email, password, Sign in and "Forgot password?". Errors show in the form.
import { auth } from "../core/auth.js";
import { el } from "../core/dom.js";

export function mountSignin(container) {
  let alive = true;
  const email = el("input", { type: "email", name: "email", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: "false" });
  const password = el("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const message = el("p", { class: "sub", role: "alert" });
  const submit = el("button", { class: "btn primary", type: "submit" }, "Sign in");
  const forgot = el("button", { class: "btn ghost", type: "button" }, "Forgot password?");
  const say = (text, bad) => { if (!alive) return; message.textContent = text; message.classList.toggle("down", !!bad); };
  const busy = (on) => { submit.disabled = on; forgot.disabled = on; };

  const form = el("form", { class: "card signin static", novalidate: true },
    el("div", { class: "label" }, "Home Dashboard"),
    el("h1", { class: "page-title" }, "Sign in"),
    el("div", { class: "form-grid", style: { gridTemplateColumns: "1fr" } },
      el("label", {}, "Email", email), el("label", {}, "Password", password)),
    message, el("div", { class: "actions" }, submit, forgot));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    say("");
    busy(true);
    try {
      await auth().signIn(email.value, password.value);
    } catch (err) {
      say(err.message, true);
    } finally {
      if (alive) busy(false);
    }
  });
  forgot.addEventListener("click", async () => {
    const address = email.value.trim();
    if (!address) { say("Type your email first, then choose Forgot password?", true); return; }
    busy(true);
    try {
      await auth().sendReset(address);
      say(`Reset email sent to ${address}`);
    } catch (err) {
      say(err.message, true);
    } finally {
      if (alive) busy(false);
    }
  });

  container.append(el("div", { class: "signin-wrap" }, form));
  email.focus();
  return () => { alive = false; };
}
