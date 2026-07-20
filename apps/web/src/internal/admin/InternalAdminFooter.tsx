export default function InternalAdminFooter({
  className = "internal-users-footer",
  label = "Internal administration legal links"
}: {
  className?: string;
  label?: string;
}) {
  return (
    <footer className={className}>
      <strong>GTT</strong>
      <div>
        <nav aria-label={label}>
          <a href="#">Terms</a>
          <a href="#">Privacy</a>
          <a href="#">Compliance</a>
          <a href="#">API Documentation</a>
        </nav>
        <p>© 2024 Global Trade Treasury. All rights reserved. Member SIPC.</p>
      </div>
    </footer>
  );
}
