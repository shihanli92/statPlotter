# Security policy

## Supported versions

Only the latest version of statPlotter receives security fixes: the web app as currently
published, and the most recent desktop release. Please check that a problem still occurs in the
latest version before reporting it.

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use GitHub's private
vulnerability reporting: on <https://github.com/shihanli92/statPlotter>, open the **Security**
tab and choose **Report a vulnerability**.

Include what an attacker could do, the steps or a file that reproduce it, the version and
whether it affects the web app, the desktop app or both (with your browser or operating system).

## What's in scope

- **Malicious files:** a project, preset, style, method or template file, or an imported data
  file (CSV, TSV, Excel, `.pzfx`), that runs code, reads or changes files it shouldn't, sends
  data anywhere, or crashes or hangs the app in a way that loses work.
- **Bypassing the security policy:** any way to make the app load scripts or connect to another
  site despite its Content-Security-Policy (for example through text, labels, images or SVG in a
  project), or otherwise send a user's data off their device.
- **The desktop app:** escaping the webview to reach files or system commands beyond what the
  user chose, problems in how it opens files from the operating system, and its update mechanism.

Out of scope: problems that need an attacker who already controls the user's computer or browser,
and bugs with no security impact (please open a normal issue for those).

## What to expect

You will get an acknowledgement within a week. We will confirm whether the problem is
reproducible, keep you informed while it is fixed, and publish the fix in a new version, normally
within a few weeks depending on its severity. We will credit you in the release notes unless you
prefer not to be named. Please keep the details private until a fix is published.
