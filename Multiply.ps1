<#
.SYNOPSIS
    Demonstrates school-style long multiplication of two decimal numbers.

.DESCRIPTION
    Writes x and y right-aligned (by their last digit, like on paper), with the
    whole part in yellow and the fractional part in white, so the position of
    the decimal point is shown by colour instead of a dot.
    Then it multiplies x by every digit of y (one row per digit, each shifted
    one place left), adds the rows, and finally places the decimal point in the
    result by counting the decimal places of x and y.

.EXAMPLE
    .\Multiply.ps1 12.5 3.25

.EXAMPLE
    .\Multiply.ps1 -X -0.75 -Y 1.2

.EXAMPLE
    .\Multiply.ps1          # asks for both numbers
#>
param(
    [Parameter(Position = 0)] [string] $X,
    [Parameter(Position = 1)] [string] $Y
)

$ErrorActionPreference = 'Stop'

$Inv   = [System.Globalization.CultureInfo]::InvariantCulture
$Times = [string][char]0x00D7   # ×
$Arrow = [string][char]0x2190   # ←

$WholeColor = 'Yellow'
$FracColor  = 'White'
$PartColor  = 'Cyan'
$SignColor  = 'Magenta'
$LineColor  = 'DarkGray'
$NoteColor  = 'DarkGray'

# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

# Splits a number typed by the user into sign, whole part and fractional part.
# The digits are kept exactly as typed (e.g. "2.50" keeps two decimal places).
function ConvertTo-Number([string] $text) {
    $t = $text.Trim().Replace(',', '.')

    # Allow scientific notation (1.5e3) by expanding it first.
    if ($t -match '[eE]') {
        $styles = [System.Globalization.NumberStyles]::Float
        $t = [decimal]::Parse($t, $styles, $Inv).ToString($Inv)
    }

    if ($t -notmatch '^(?<sign>[+-]?)(?<whole>\d*)(?:\.(?<frac>\d*))?$' -or
        "$($Matches.whole)$($Matches.frac)" -eq '') {
        throw "'$text' is not a valid number."
    }

    $whole = "$($Matches.whole)".TrimStart('0')
    if ($whole -eq '') { $whole = '0' }
    $frac   = "$($Matches.frac)"
    $digits = $whole + $frac

    [pscustomobject]@{
        Negative = $Matches.sign -eq '-'
        Whole    = $whole
        Frac     = $frac
        Digits   = $digits                                   # all digits, no dot
        Value    = [System.Numerics.BigInteger]::Parse($digits) # digits as an integer
        Text     = ($(if ($Matches.sign -eq '-') { '-' } else { '' }) + $whole +
                    $(if ($frac) { '.' + $frac } else { '' }))
    }
}

# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

function New-Seg([string] $text, [string] $color) {
    [pscustomobject]@{ Text = $text; Color = $color }
}

function Get-RowLength($segments) {
    $len = 0
    foreach ($s in $segments) { $len += $s.Text.Length }
    $len
}

# Segments for a number whose last $fracCount digits are the fractional part.
function Get-NumberSegments([string] $digits, [int] $fracCount, [bool] $negative) {
    $segs = @()
    if ($negative) { $segs += New-Seg '-' $SignColor }
    $wholeLen = $digits.Length - $fracCount
    if ($wholeLen -gt 0) { $segs += New-Seg $digits.Substring(0, $wholeLen) $WholeColor }
    if ($fracCount -gt 0) { $segs += New-Seg $digits.Substring($wholeLen) $FracColor }
    $segs
}

# Writes one row right-aligned to $width. $prefix (e.g. "×" or "+") goes in
# column 0, $note is printed to the right of the row.
function Write-Row($segments, [int] $width, [string] $prefix = '', [string] $note = '') {
    $pad = $width - (Get-RowLength $segments)
    if ($prefix) {
        Write-Host $prefix -NoNewline -ForegroundColor $LineColor
        $pad -= $prefix.Length
    }
    Write-Host (' ' * [Math]::Max(0, $pad)) -NoNewline
    foreach ($s in $segments) {
        Write-Host $s.Text -NoNewline -ForegroundColor $s.Color
    }
    if ($note) { Write-Host "   $note" -NoNewline -ForegroundColor $NoteColor }
    Write-Host ''
}

function Write-Line([int] $length, [int] $width) {
    Write-Row @(New-Seg ('-' * $length) $LineColor) $width
}

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

if (-not $X) { $X = Read-Host 'Enter x' }
if (-not $Y) { $Y = Read-Host 'Enter y' }

$a = ConvertTo-Number $X
$b = ConvertTo-Number $Y

# ---------------------------------------------------------------------------
# Computation
# ---------------------------------------------------------------------------

$fracCount  = $a.Frac.Length + $b.Frac.Length
$negative   = $a.Negative -xor $b.Negative
$product    = $a.Value * $b.Value
$isNegative = $negative -and -not $product.IsZero

# Multiply by the significant digits of y only (no rows for leading zeros
# such as the "0" in 0.25), but always at least one row.
$multiplier = $b.Value.ToString()
$xText      = $a.Value.ToString()

$partials = @()
for ($i = 0; $i -lt $multiplier.Length; $i++) {
    $digit = [int][string]$multiplier[$multiplier.Length - 1 - $i]
    if ($digit -eq 0) {
        $pText = '0' * $xText.Length
    } else {
        $pText = ($a.Value * $digit).ToString()
    }
    $note = "$Arrow $xText $Times $digit"
    if ($i -gt 0) { $note += ", shifted $i place$(if ($i -gt 1) { 's' })" }

    $partials += [pscustomobject]@{
        Segments = @(New-Seg $pText $PartColor; New-Seg (' ' * $i) $PartColor)
        Note     = $note
    }
}

# The result needs at least one whole digit in front of the decimal places.
$resultDigits = $product.ToString().PadLeft($fracCount + 1, '0')
$resultSegs   = Get-NumberSegments $resultDigits $fracCount $isNegative

$xSegs = Get-NumberSegments $a.Digits $a.Frac.Length $a.Negative
$ySegs = Get-NumberSegments $b.Digits $b.Frac.Length $b.Negative

# ---------------------------------------------------------------------------
# Layout
# ---------------------------------------------------------------------------

$operandLen = [Math]::Max((Get-RowLength $xSegs), (Get-RowLength $ySegs))
$workLen    = Get-RowLength $resultSegs
foreach ($p in $partials) { $workLen = [Math]::Max($workLen, (Get-RowLength $p.Segments)) }

$width = [Math]::Max($operandLen, $workLen) + 2   # +2 for the "× " / "+ " column

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'Colours: ' -NoNewline
Write-Host 'whole part' -NoNewline -ForegroundColor $WholeColor
Write-Host ', ' -NoNewline
Write-Host 'fractional part' -NoNewline -ForegroundColor $FracColor
Write-Host ', ' -NoNewline
Write-Host 'partial products' -ForegroundColor $PartColor
Write-Host ''

Write-Row $xSegs $width
Write-Row $ySegs $width $Times
Write-Line $operandLen $width

if ($partials.Count -eq 1) {
    # A single-digit multiplier: the only row already is the answer.
    Write-Row $resultSegs $width '' ($partials[0].Note)
} else {
    for ($i = 0; $i -lt $partials.Count; $i++) {
        $prefix = if ($i -eq $partials.Count - 1) { '+' } else { '' }
        Write-Row $partials[$i].Segments $width $prefix $partials[$i].Note
    }
    Write-Line $workLen $width
    Write-Row $resultSegs $width '' "$Arrow sum of the rows"
}

Write-Host ''
Write-Host "Decimal places: $($a.Frac.Length) (x) + $($b.Frac.Length) (y) = $fracCount" `
    "-> count $fracCount digit$(if ($fracCount -ne 1) { 's' }) from the right." -ForegroundColor $NoteColor

# Final result with a real decimal point.
$wholeLen   = $resultDigits.Length - $fracCount
$resultText = $(if ($isNegative) { '-' } else { '' }) + $resultDigits.Substring(0, $wholeLen) +
              $(if ($fracCount -gt 0) { '.' + $resultDigits.Substring($wholeLen) } else { '' })

Write-Host ''
Write-Host "$($a.Text) $Times $($b.Text) = " -NoNewline
if ($isNegative) { Write-Host '-' -NoNewline -ForegroundColor $SignColor }
Write-Host $resultDigits.Substring(0, $wholeLen) -NoNewline -ForegroundColor $WholeColor
if ($fracCount -gt 0) {
    Write-Host '.' -NoNewline
    Write-Host $resultDigits.Substring($wholeLen) -NoNewline -ForegroundColor $FracColor
}
Write-Host ''

# Cross-check with PowerShell's own decimal arithmetic (skipped if too large).
try {
    $check = ([decimal]::Parse($a.Text, $Inv) * [decimal]::Parse($b.Text, $Inv))
    $ok    = $check -eq [decimal]::Parse($resultText, $Inv)
    $mark  = if ($ok) { 'OK' } else { 'MISMATCH' }
    Write-Host "Check: [decimal] says $($check.ToString($Inv)) -> $mark" `
        -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
} catch {
    Write-Host 'Check skipped: numbers too large for [decimal].' -ForegroundColor $NoteColor
}
Write-Host ''
