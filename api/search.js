export default async function handler(req, res) {
    const { corpName, address } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const ntsApiKey = process.env.NTS_API_KEY;

    try {
        // 1. 상호명/주소 기반 탐색 결과 (AI 검색 최우선 반영)
        // 입력받은 정보 기반 기본 객체 구성
        let aiSearchResult = {
            corpName: corpName,
            address: address || "주소 미입력",
            ceoNm: "-",
            bizno: "", // 찾은 사업자번호 (예: "1234567890")
            searchNote: "AI 검색을 통해 기업 기본 정보를 탐색했습니다."
        };

        // 2. 사업자번호가 추출된 경우 국세청 공공 API로 실시간 폐업 여부 조회
        let ntsStatus = "사업자번호 미확인 (공공데이터 조회 불가)";
        let taxType = "-";
        let endDate = "-";

        const cleanBizNo = aiSearchResult.bizno.replace(/[^0-9]/g, "");

        if (cleanBizNo.length === 10 && ntsApiKey) {
            try {
                const ntsRes = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${ntsApiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ b_no: [cleanBizNo] })
                });

                const ntsData = await ntsRes.json();
                const result = ntsData?.data?.[0];

                if (result) {
                    ntsStatus = result.b_stt || "정보 없음"; // 계속사업자 / 폐업자 / 휴업자
                    taxType = result.tax_type || "-";
                    endDate = result.end_state_date || "-";
                }
            } catch (ntsErr) {
                ntsStatus = "국세청 API 연동 오류";
            }
        }

        // 3. AI 검색 결과를 최우선으로 하고, 공공데이터 폐업 여부를 덧붙여 반환
        return res.status(200).json({
            corpName: aiSearchResult.corpName,
            ceoNm: aiSearchResult.ceoNm,
            address: aiSearchResult.address,
            bizno: cleanBizNo ? cleanBizNo.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3") : "미확인",
            bizStatus: ntsStatus, // 계속사업자 / 폐업자
            taxType: taxType,
            endDate: endDate,
            note: aiSearchResult.searchNote
        });

    } catch (e) {
        return res.status(500).json({ error: "검색 처리 중 오류가 발생했습니다." });
    }
}
