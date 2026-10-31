# Invoked as trusted source via -Command, without changing execution policy.
$ErrorActionPreference = 'Stop'
try {
 $p = $env:C3C15B_ACL_PATH
 $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
 $system = New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'
 $sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
 function Assert-NoLink([string]$target) {
  $item = New-Object IO.DirectoryInfo $target
  while ($null -ne $item) {
   if ($item.Exists -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'C15B_REPARSE_STATE' }
   $item = $item.Parent
  }
 }
 function Assert-Private([string]$target) {
  Assert-NoLink $target
  $item = New-Object IO.DirectoryInfo $target
  $acl = $item.GetAccessControl($sections)
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'C15B_PRIVATE_OWNER' }
  if (-not $acl.AreAccessRulesProtected) { throw 'C15B_PRIVATE_INHERITANCE' }
  $rules = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 2) { throw 'C15B_PRIVATE_RULES' }
  foreach ($identity in @($sid,$system)) {
   $matching = @($rules | Where-Object { $_.IdentityReference.Value -eq $identity.Value })
   if ($matching.Count -ne 1) { throw 'C15B_PRIVATE_IDENTITY' }
   $r = $matching[0]
   if ($r.IsInherited -or $r.AccessControlType -ne 'Allow' -or
       $r.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
       $r.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' -or
       $r.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { throw 'C15B_PRIVATE_RIGHTS' }
  }
 }
 Assert-NoLink $p
 if ([IO.File]::Exists($p)) { throw 'C15B_PRIVATE_FILE' }
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($identity in @($sid,$system)) {
   $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl',[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,'Allow')
   [void]$acl.AddAccessRule($rule)
  }
 $parent = [IO.Directory]::GetParent($p)
 if (-not $parent.Exists) { $parent.Create($acl) }
 Assert-NoLink $p
 $parentAcl = $parent.GetAccessControl($sections)
 if ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'C15B_PRIVATE_PARENT_OWNER' }
 # DELETE_CHILD on the parent could permit replacing a protected directory.
 # Administrators remain outside the threat model; never add any parent permission.
 $writeMask = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
 foreach ($rule in $parentAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow' -and
      -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
      ($rule.FileSystemRights -band $writeMask) -and
      $rule.IdentityReference.Value -notin @($sid.Value,$system.Value,'S-1-5-32-544')) { throw 'C15B_PRIVATE_PARENT_WRITABLE' }
 }
 if (-not [IO.Directory]::Exists($p)) {
  # Atomic DACL on creation; Windows assigns owner. Never request SACL or SetOwner.
  $item = New-Object IO.DirectoryInfo $p
  $item.Create($acl)
 }
 # Existing directories are rejected if insecure, never repaired or adopted.
 Assert-Private $p
 # Refuse exposed or linked descendants before any secret can be read.
 $pending = New-Object 'Collections.Generic.Queue[string]'
 $pending.Enqueue($p)
 while ($pending.Count -gt 0) {
 foreach ($child in Get-ChildItem -LiteralPath ($pending.Dequeue()) -Force) {
  if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'C15B_PRIVATE_CHILD_LINK' }
  if ($child.PSIsContainer) { $pending.Enqueue($child.FullName) }
  $childAcl = $child.GetAccessControl($sections)
  if ($childAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'C15B_PRIVATE_CHILD_OWNER' }
  $childRules = @($childAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if ($childRules.Count -ne 2) { throw 'C15B_PRIVATE_CHILD_RULES' }
  foreach ($identity in @($sid,$system)) {
   $matches = @($childRules | Where-Object { $_.IdentityReference.Value -eq $identity.Value })
   if ($matches.Count -ne 1 -or $matches[0].AccessControlType -ne 'Allow' -or
       $matches[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
       ($matches[0].PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { throw 'C15B_PRIVATE_CHILD_RIGHTS' }
  }
 }
 }
 $probe = Join-Path $p ([Guid]::NewGuid().ToString('N') + '.acl-probe')
 $stream = [IO.File]::Open($probe,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 try { $stream.WriteByte(1); $stream.Position=0; if ($stream.ReadByte() -ne 1) { throw 'C15B_PRIVATE_EFFECTIVE' } }
 finally { $stream.Dispose(); [IO.File]::Delete($probe) }
 Assert-Private $p
} catch { [Console]::Error.WriteLine('C15B_PRIVATE_ACL'); exit 1 }
