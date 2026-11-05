export default async function handler(req, res) {
    const { corpName, bizNo } = req.query;

    const targetBizNo = bizNo || corpName;
    const cleanBizNo = targetBizNo ? targetBizNo.replace(/[^0-9]/g, "") : "";

    if (!cleanBizNo || cleanBizNo.length !== 10) {
        return res.status(400).json({ 
            error: "조회할 사업자등록번호 10자리를 정확히 입력해 주세요." 
        });
    }

    const ntsApiKey = process.env.NTS_API_KEY;
    if (!ntsApiKey) {
        return res.status(500).json({ error: "국세청 API 키가 설정되지 않았습니다." });
    }

    try {
        const ntsRes = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${ntsApiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ b_no: [cleanBizNo] })
        });

        const ntsData = await ntsRes.json();
        const result = ntsData?.data?.[0];

        if (!result) {
            return res.status(404).json({ error: "해당 사업자번호 조회의 결과가 없습니다." });
        }

        // 국세청 응답 상태값 (예: 계속사업자, 폐업자 등)
        let statusText = result.b_stt || "정보 없음";

        return res.status(200).json({
            bizno: cleanBizNo.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3"),
            bizStatus: statusText,
            taxType: result.tax_type || "정보 없음",
            endStateDate: result.end_state_date || "-"
        });

    } catch (e) {
        return res.status(500).json({ error: "국세청 시스템과의 통신 중 오류가 발생했습니다." });
    }
}
