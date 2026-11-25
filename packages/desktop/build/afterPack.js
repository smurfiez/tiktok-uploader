// Unsigned releases (CI has no certificate) still need a signature that covers the
// packaged resources: on Apple Silicon a bundle whose seal does not match is reported
// as "damaged" instead of the friendlier "unidentified developer".
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async (context) => {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false') return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
