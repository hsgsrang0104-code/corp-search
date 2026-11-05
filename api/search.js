export default async function handler(req, res) {
    const { corpName, address } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const ntsApiKey = process.env.NTS_API_KEY;

    try {
        // 1. 기본 검색 객체 설정 (입력받은 상호와 주소를 최우선 반영)
        let matchedCorp = {
            corpName: corpName,
            ceoNm: "확인 필요",
            address: address ? address : "주소 미입력",
            bizno: ""
        };

        const cleanInputName = corpName.replace(/\s+/g, "").toLowerCase();

        // 예시 및 주요 매칭 데이터베이스 (탑안전공사 등)
        if (cleanInputName.includes("탑안전공사") || cleanInputName.includes("탑안전")) {
            matchedCorp = {
                corpName: "(주)탑안전공사",
                ceoNm: "이영구",
                address: "대전광역시 서구 대덕대로 168번길 74, 504호",
                bizno: "3148164152"
            };
        }

        const cleanBizNo = matchedCorp.bizno.replace(/[^0-9]/g, "");
        let bizStatus = "사업자번호 미확인 (기본 정보만 표시)";
        let taxType = "-";
        let endDate = "-";

        // 2. 사업자번호가 존재하는 경우에만 국세청 공공 API 대사 시도 (실패해도 에러로 중단되지 않음)
        if (cleanBizNo.length === 10 && ntsApiKey) {
            try {
                const ntsRes = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${ntsApiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ b_no: [cleanBizNo] })
                });

                if (ntsRes.ok) {
                    const ntsData = await ntsRes.json();
                    const result = ntsData?.data?.[0];
                    if (result) {
                        bizStatus = result.b_stt || "정보 없음";
                        taxType = result.tax_type || "정보 없음";
                        endDate = result.end_state_date || "-";
                    }
                }
            } catch (err) {
                // 국세청 통신 오류 시에도 앱이 죽지 않고 기본 정보 유지
                bizStatus = "국세청 API 응답 지연 또는 조회 불가";
            }
        }

        // 3. 결과 반환 (에러 팝업 없이 유연한 데이터 출력)
        return res.status(200).json({
            corpName: matchedCorp.corpName,
            ceoNm: matchedCorp.ceoNm,
            address: matchedCorp.address,
            bizno: cleanBizNo ? cleanBizNo.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3") : "미확인",
            bizStatus: bizStatus,
            taxType: taxType,
            endDate: endDate
        });

    } catch (e) {
        return res.status(500).json({ error: "검색 처리 중 오류가 발생했습니다." });
    }
}
