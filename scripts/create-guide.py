from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "JARVIS-VERY-SIMPLE-GUIDE.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
pdfmetrics.registerFont(TTFont("JarvisSans", FONT))
pdfmetrics.registerFont(TTFont("JarvisBold", BOLD))

amber = HexColor("#FFB21F")
dark = HexColor("#061015")
panel = HexColor("#0B1A21")
muted = HexColor("#89A1AA")
green = HexColor("#61EFB2")

doc = SimpleDocTemplate(
    str(OUTPUT), pagesize=letter,
    rightMargin=0.48 * inch, leftMargin=0.48 * inch,
    topMargin=0.42 * inch, bottomMargin=0.38 * inch,
    title="JARVIS Very Simple Setup Guide",
    author="Adam",
)

title = ParagraphStyle("title", fontName="JarvisBold", fontSize=24, leading=27, textColor=amber, alignment=TA_CENTER)
subtitle = ParagraphStyle("subtitle", fontName="JarvisSans", fontSize=9.5, leading=13, textColor=muted, alignment=TA_CENTER)
step_title = ParagraphStyle("step_title", fontName="JarvisBold", fontSize=11, leading=14, textColor=white)
step_body = ParagraphStyle("step_body", fontName="JarvisSans", fontSize=8.5, leading=12, textColor=muted)
small = ParagraphStyle("small", fontName="JarvisSans", fontSize=7.4, leading=10.5, textColor=muted)
center = ParagraphStyle("center", parent=small, alignment=TA_CENTER)

story = [
    Paragraph("JARVIS", title),
    Paragraph("VERY SIMPLE WINDOWS SETUP - FREE, PRIVATE, AND LOCAL", subtitle),
    Spacer(1, 0.12 * inch),
]

preview = ROOT / "assets" / "design-preview-v2.png"
if preview.exists():
    image = Image(str(preview), width=6.9 * inch, height=3.15 * inch)
    story.extend([image, Spacer(1, 0.13 * inch)])

steps = [
    ("1", "INSTALL JARVIS", "Double-click <b>JARVIS-FREE-SETUP.exe</b>. Choose Install. JARVIS creates its own desktop shortcut and opens automatically."),
    ("2", "INSTALL OLLAMA", "Click <link href='https://ollama.com/download/windows' color='#FFB21F'><u>ollama.com/download/windows</u></link>, install it, and leave the small Ollama icon running near the Windows clock. Already have Ollama? Skip this step."),
    ("3", "OPEN JARVIS", "JARVIS connects to Ollama automatically. In Settings, a green light saying <font color='#61EFB2'><b>LOCAL BRAIN ONLINE</b></font> means you are finished."),
]

cells = []
for number, heading, body in steps:
    cells.append([
        Paragraph(f"<font color='#FFB21F' size='18'><b>{number}</b></font>", center),
        Paragraph(f"{heading}<br/><font name='JarvisSans' size='8.5' color='#89A1AA'>{body}</font>", step_title),
    ])

table = Table(cells, colWidths=[0.48 * inch, 6.32 * inch], rowHeights=[0.62 * inch] * 3)
table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), panel),
    ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#27414C")),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, HexColor("#1A3039")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (1, 0), (1, -1), 10),
    ("RIGHTPADDING", (1, 0), (1, -1), 8),
]))
story.extend([table, Spacer(1, 0.13 * inch)])

setup = Table([
    [Paragraph("FIRST-TIME SETTINGS", step_title), Paragraph("TRY THESE COMMANDS", step_title)],
    [Paragraph("1. Enter your name.<br/>2. Add folders JARVIS may search.<br/>3. Select <b>Install Local Voice</b> for free wake word and speech.<br/>4. Slow GPU? Choose optional <b>Cloud Brain</b> and add prepaid API credit.", small),
     Paragraph("Hey Jarvis, summarize my latest report.<br/>Hey Jarvis, search inside my documents for fittings.<br/>Hey Jarvis, organize my Downloads.", small)],
], colWidths=[3.4 * inch, 3.4 * inch])
setup.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), dark),
    ("BOX", (0, 0), (-1, -1), 0.6, amber),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, HexColor("#27414C")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.extend([
    setup,
    Spacer(1, 0.11 * inch),
    Paragraph("Reads PDF, DOCX, XLSX, CSV and text files in approved folders. File changes require approval. Local mode needs no API credit; optional Cloud Brain helps slower computers.", center),
    Spacer(1, 0.06 * inch),
    Paragraph("Unofficial fan-made productivity software. Not affiliated with Marvel, Disney, OpenAI, or Ollama.", center),
])


def page(canvas, _doc):
    canvas.saveState()
    canvas.setFillColor(dark)
    canvas.rect(0, 0, letter[0], letter[1], fill=1, stroke=0)
    canvas.setFillColor(amber)
    canvas.rect(0, letter[1] - 5, letter[0], 5, fill=1, stroke=0)
    canvas.restoreState()


doc.build(story, onFirstPage=page)
print(OUTPUT)
