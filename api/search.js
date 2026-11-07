export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "GET 요청만 허용됩니다."
        });
    }

    const corpName = String(req.query.corpName || "").trim();
    const queryBizno = String(req.query.bizno || "").trim();
    const queryAddress = String(req.query.address || "").trim();

    if (!corpName) {
        return res.status(400).json({
            success: false,
            error: "상호명이 전달되지 않았습니다."
        });
    }

    const ntsApiKey = process.env.NTS_API_KEY;
    const financeApiKey = process.env.DATA_GO_KR_API_KEY;

    function formatBizNo(value) {
        const number = String(value || "").replace(/\D/g, "");
        if (number.length !== 10) return value || "정보없음";
        return number.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3");
    }

    function formatCorpNo(value) {
        const number = String(value || "").replace(/\D/g, "");
        if (number.length !== 13) return value || "정보없음";
        return number.replace(/^(\d{6})(\d{7})$/, "$1-$2");
    }

    function normalize(value) {
        return String(value || "")
            .replace(/주식회사|㈜|\(주\)|주\)/g, "")
            .replace(/\s/g, "")
            .replace(/[()（）]/g, "")
            .toLowerCase();
    }

    try {
        let businessNumber = queryBizno.replace(/\D/g, "");
        let initialCompanyName = corpName;
        let initialCrno = "";
        let initialAddress = queryAddress || "정보없음";
        let ceoName = "정보없음";
        let phoneNum = "정보없음";
        let ntsStatus = "국세청 조회 필요";

        // =====================================
        // 1. 국세청 API 사업자 상태 검증
        // =====================================
        if (ntsApiKey && /^\d{10}$/.test(businessNumber)) {
            try {
                const ntsUrl = "https://api.odcloud.kr/api/nts-businessman/v1/status";
                const ntsResponse = await fetch(`${ntsUrl}?serviceKey=${encodeURIComponent(ntsApiKey)}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({ b_no: [businessNumber] })
                });

                if (ntsResponse.ok) {
                    const ntsData = await ntsResponse.json();
                    const resultList = ntsData?.data || [];
                    const ntsResult = resultList.find(item =>
                        String(item.b_no || "").replace(/\D/g, "") === businessNumber
                    );

                    if (ntsResult) {
                        if (ntsResult.b_stt_cd === "01") ntsStatus = "계속사업자";
                        else if (ntsResult.b_stt_cd === "02") ntsStatus = "휴업자";
                        else if (ntsResult.b_stt_cd === "03") ntsStatus = "폐업자";
                        else ntsStatus = ntsResult.b_stt || "정보 확인 필요";
                    } else {
                        ntsStatus = "국세청 등록정보 없음";
                    }
                } else {
                    ntsStatus = "국세청 응답 오류";
                }
            } catch (ntsErr) {
                console.warn("국세청 API 예외:", ntsErr.message);
                ntsStatus = "국세청 조회 실패";
            }
        } else {
            ntsStatus = ntsApiKey ? "사업자번호 형식 오류" : "국세청 인증키 미설정";
        }

        // =====================================
        // 2. 금융위원회 API (상세 주소, 전화번호, 법인번호 보완)
        // =====================================
        if (financeApiKey) {
            try {
                const financeUrl = "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2";
                const params = new URLSearchParams({
                    serviceKey: financeApiKey,
                    resultType: "json",
                    pageNo: "1",
                    numOfRows: "10",
                    corpNm: corpName
                });

                const finResponse = await fetch(`${financeUrl}?${params.toString()}`);
                if (finResponse.ok) {
                    const finText = await finResponse.text();
                    const finData = JSON.parse(finText);
                    const finItems = finData?.response?.body?.items?.item;
                    let finList = Array.isArray(finItems) ? finItems : (finItems ? [finItems] : []);

                    // 사업자번호 또는 상호명으로 정확히 일치하는 항목 매칭
                    const matchedFin = finList.find(f => {
                        const fBiz = String(f.bzno || "").replace(/\D/g, "");
                        return fBiz === businessNumber || normalize(f.corpNm) === normalize(initialCompanyName);
                    }) || finList[0];

                    if (matchedFin) {
                        if (matchedFin.enpRprFnm) ceoName = matchedFin.enpRprFnm;
                        if (matchedFin.enpTlno) phoneNum = matchedFin.enpTlno;
                        if (matchedFin.enpBsadr) initialAddress = matchedFin.enpBsadr; // 상세 주소 우선 반영
                        if (matchedFin.crno) initialCrno = matchedFin.crno;
                    }
                }
            } catch (finErr) {
                console.warn("금융위원회 API 예외:", finErr.message);
            }
        }

        // 만약 금융위에서 주소를 못 가져왔거나 기본값(대전 서구 등 짧은 주소)이라면, 프론트엔드에서 넘어온 주소를 최대한 유지
        return res.status(200).json({
            success: true,
            corpName: initialCompanyName,
            ceoNm: ceoName,
            bizno: formatBizNo(businessNumber),
            crno: formatCorpNo(initialCrno),
            phone: phoneNum,
            address: initialAddress,
            status: ntsStatus,
            source: "비즈노 + 국세청 + 금융위원회"
        });

    } catch (error) {
        console.error("서버 내부 치명적 오류:", error);
        return res.status(500).json({
            success: false,
            error: "서버 처리 중 오류가 발생했습니다: " + error.message
        });
    }
}
