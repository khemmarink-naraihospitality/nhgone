from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.services import reconciliation_service

router = APIRouter(prefix="/reconciliation", tags=["Reconciliation"])


@router.post("/gl-split")
async def gl_split(file: UploadFile = File(...)):
    """Splits one GL Account Detail export into a per-account-code workbook
    (All Transactions / Outstanding / Offset - offset pairs are transactions
    whose amounts exactly cancel) plus a summary, all zipped together."""
    try:
        content = await file.read()
        zip_bytes = reconciliation_service.run_gl_split(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GL split failed: {str(e)}")

    filename = f"GL_Reconciliation_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/bank-gl-match")
async def bank_gl_match(bank_file: UploadFile = File(...), gl_file: UploadFile = File(...)):
    """Matches Bank Statement rows to GL Statement rows by amount and a +-1
    day date tolerance, producing matched pairs plus each side's
    outstanding (unmatched) items in one workbook."""
    try:
        bank_bytes = await bank_file.read()
        gl_bytes = await gl_file.read()
        xlsx_bytes = reconciliation_service.run_bank_gl_match(bank_bytes, gl_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bank vs GL matching failed: {str(e)}")

    filename = f"Bank_GL_Reconciliation_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
