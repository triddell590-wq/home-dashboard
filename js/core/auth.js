// The sign-in interface every view uses. Backends (memory, Firebase) plug in through useAuth().
let impl = null;

export function useAuth(backend) {
  impl = backend;
}

export function auth() {
  if (!impl) throw new Error("No sign-in backend");
  return impl;
}
