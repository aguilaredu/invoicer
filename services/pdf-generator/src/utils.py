from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent


def get_path(relative_path: str) -> Path:
    """Return an absolute path from project root."""
    return BASE_DIR / relative_path


def load_invoice_data(invoice_data_path: str | Path) -> pd.DataFrame:
    invoice_data = pd.read_csv(invoice_data_path)
    invoice_data.columns = invoice_data.columns.str.lower().str.replace(" ", "_")

    invoice_data = invoice_data.rename(
        columns={"pendiente": "pendiente", "invoice_number": "numero_factura"}
    )

    invoice_data["cuota"] = pd.to_numeric(
        invoice_data["cuota"], errors="coerce"
    ).fillna(0.0)  # type: ignore
    invoice_data["pendiente"] = pd.to_numeric(
        invoice_data["pendiente"], errors="coerce"
    ).fillna(0.0)  # type: ignore
    invoice_data["telefono"] = invoice_data["telefono"].fillna("").astype(str)
    return invoice_data


def get_invoice_name(row, invoice_config: dict) -> str:
    nombre = row["nombre"]
    numero_factura = row["numero_factura"]
    month = invoice_config["month"]
    year = invoice_config["year"]
    file_name = f"{numero_factura}-{nombre}-{month}-{year}.pdf"
    return file_name


def generate_whatsapp_message(row, invoice_config: dict, whatsapp_config: dict) -> str:
    """Generate the whatsapp message based on the pending amount."""
    pending_amount = row["pendiente"]
    if pending_amount > 0:
        template = whatsapp_config["template_bad"]
        return template.format(
            name=row["nombre"],
            month=invoice_config["month"],
            year=invoice_config["year"],
            pending=pending_amount,
        )
    else:
        template = whatsapp_config["template_good"]
        return template.format(
            name=row["nombre"],
            month=invoice_config["month"],
            year=invoice_config["year"],
        )
