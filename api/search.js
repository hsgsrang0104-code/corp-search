export default async function handler(req, res) {
    const { corpName } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "API 키가 설정되지 않았습니다." });
    }

    try {
        // 공공데이터포털 표준 인코딩 적용 (서비스 키는 이미 디코딩된 상태이므로 그대로 사용)
        const encodedName = encodeURIComponent(corpName.trim());
        const url = `https://apis.data.go.kr/1160100/service/GetCorpOutlineInfoService_v2/getCorpOutline_V2?serviceKey=${apiKey}&resultType=json&pageNo=1&numOfRows=5&corpNm=${encodedName}`;

        const response = await fetch(url);
        const text = await response.text();

        // 만약 공공데이터포털에서 에러 XML이나 HTML을 반환한 경우 화면에 그대로 노출
        if (!text.trim().startsWith("{")) {
            return res.status(200).json({
                success: false,
                corpName: "API 서버 응답 오류 (인증키 만료 또는 일일 트래픽 초과)",
                ceoNm: text.substring(0, 60),
                bizno: "확인필요",
                crno: "정보없음",
                phone: "정보없음",
                address: "공공데이터포털 승인 상태를 확인해주세요",
                status: "오류"
            });
        }

        const data = JSON.parse(text);
        const items = data?.response?.body?.items?.item;
        
        let itemList = [];
        if (Array.isArray(items)) {
            itemList = items;
        } else if (items) {
            itemList = [items];
        }

        if (itemList.length === 0) {
            return res.status(200).json({
                success: false,
                corpName: `${corpName} - 검색 결과 없음`,
                ceoNm: "정보없음",
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: "DB에 등록되지 않았거나 명칭이 다를 수 있습니다.",
                status: "결과없음"
            });
        }

        const target = itemList[0];

        return res.status(200).json({
            success: true,
            corpName: target.corpNm || corpName,
            ceoNm: target.ceoNm || "정보없음",
            bizno: target.bizNo || "정보없음",
            crno: target.crno || "정보없음",
            phone: target.enpTlno || "정보없음",
            address: target.enpBsadr || "정보없음",
            status: "계속사업자"
        });

    } catch (error) {
        return res.status(500).json({ error: "서버 내부 오류: " + error.message });
    }
}
